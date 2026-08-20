package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/logger"
	dbmodel "github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay"
	"github.com/songquanpeng/one-api/relay/adaptor"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/apitype"
	"github.com/songquanpeng/one-api/relay/billing"
	billingratio "github.com/songquanpeng/one-api/relay/billing/ratio"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
	"github.com/songquanpeng/one-api/relay/timing"
)

func RelayTextHelper(c *gin.Context) *model.ErrorWithStatusCode {
	ctx := c.Request.Context()
	meta := meta.GetByContext(c)
	// get & validate textRequest
	textRequest, err := getAndValidateTextRequest(c, meta.Mode)
	if err != nil {
		logger.Errorf(ctx, "getAndValidateTextRequest failed: %s", err.Error())
		timing.Finish(c, "error", timing.F("err", err.Error()))
		recordRelayErrorLog(c, meta, nil, err.Error())
		return openai.ErrorWrapper(err, "invalid_text_request", http.StatusBadRequest)
	}
	meta.IsStream = textRequest.Stream

	// map model name
	meta.OriginModelName = textRequest.Model
	textRequest.Model, _ = getMappedModelName(textRequest.Model, meta.ModelMapping)
	meta.ActualModelName = textRequest.Model
	timing.SetRequestInfo(c, meta.OriginModelName, meta.ActualModelName, meta.IsStream)
	// set system prompt if not empty
	systemPromptReset := setSystemPrompt(ctx, textRequest, meta.ForcedSystemPrompt)
	// inject skill content as user message
	if skillPrompt := c.GetString(ctxkey.SkillUserPrompt); skillPrompt != "" {
		injectSkillUserMessage(textRequest, skillPrompt)
	}
	// get model ratio & group ratio
	modelRatio := billingratio.GetModelRatio(textRequest.Model, meta.ChannelType)
	groupRatio := billingratio.GetGroupRatio(meta.Group)
	ratio := modelRatio * groupRatio
	// pre-consume quota
	promptTokens := getPromptTokens(textRequest, meta.Mode)

	// context length protection: truncate if over limit
	if meta.Mode == relaymode.ChatCompletions && len(textRequest.Messages) > 0 {
		modelLimit := config.GetModelContextLimit(textRequest.Model)
		if promptTokens > modelLimit {
			truncated := truncateMessagesToLimit(textRequest.Messages, textRequest.Model, modelLimit)
			if len(truncated) < len(textRequest.Messages) {
				logger.Infof(ctx, "messages truncated from %d to %d messages, model=%s, tokens=%d->%d",
					len(textRequest.Messages), len(truncated), textRequest.Model, promptTokens,
					openai.CountTokenMessages(truncated, textRequest.Model))
				textRequest.Messages = truncated
				promptTokens = getPromptTokens(textRequest, meta.Mode)
			}
			if promptTokens > modelLimit {
				timing.Finish(c, "error", timing.F("err", "context_length_exceeded"))
				recordRelayErrorLog(c, meta, textRequest, "context_length_exceeded")
				return openai.ErrorWrapper(
					fmt.Errorf("输入内容过长（约 %d tokens），已截断至最少消息数仍超出模型限制（%d tokens），请开始新对话", promptTokens, modelLimit),
					"context_length_exceeded",
					http.StatusBadRequest,
				)
			}
		}
	}

	meta.PromptTokens = promptTokens
	preConsumedQuota, bizErr := preConsumeQuota(ctx, textRequest, promptTokens, ratio, meta)
	if bizErr != nil {
		logger.Warnf(ctx, "preConsumeQuota failed: %+v", *bizErr)
		timing.Finish(c, "error", timing.F("err", bizErr.Error.Message))
		recordRelayErrorLog(c, meta, textRequest, bizErr.Error.Message)
		return bizErr
	}

	adaptor := relay.GetAdaptor(meta.APIType)
	if adaptor == nil {
		returnPreConsumedQuota(ctx, preConsumedQuota, meta)
		timing.Finish(c, "error", timing.F("err", fmt.Sprintf("invalid api type: %d", meta.APIType)))
		recordRelayErrorLog(c, meta, textRequest, fmt.Sprintf("invalid api type: %d", meta.APIType))
		return openai.ErrorWrapper(fmt.Errorf("invalid api type: %d", meta.APIType), "invalid_api_type", http.StatusBadRequest)
	}
	adaptor.Init(meta)

	// 不传 max_tokens 给上游，避免 thinking tokens 占用 content 预算
	textRequest.MaxTokens = 0

	// get request body
	requestBody, err := getRequestBody(c, meta, textRequest, adaptor)
	if err != nil {
		returnPreConsumedQuota(ctx, preConsumedQuota, meta)
		timing.Finish(c, "error", timing.F("err", err.Error()))
		recordRelayErrorLog(c, meta, textRequest, err.Error())
		return openai.ErrorWrapper(err, "convert_request_failed", http.StatusInternalServerError)
	}

	// do request
	resp, err := adaptor.DoRequest(c, meta, requestBody)
	if err != nil {
		returnPreConsumedQuota(ctx, preConsumedQuota, meta)
		logger.Errorf(ctx, "DoRequest failed: %s", err.Error())
		timing.Finish(c, "error", timing.F("err", err.Error()))
		recordRelayErrorLog(c, meta, textRequest, err.Error())
		return openai.ErrorWrapper(err, "do_request_failed", http.StatusInternalServerError)
	}
	if isErrorHappened(meta, resp) {
		returnPreConsumedQuota(ctx, preConsumedQuota, meta)
		errResp := RelayErrorHandler(resp)
		errMsg := ""
		if errResp != nil {
			errMsg = errResp.Error.Message
		}
		timing.Finish(c, "error", timing.F("err", errMsg))
		recordRelayErrorLog(c, meta, textRequest, errMsg)
		return errResp
	}

	// do response
	usage, respErr := adaptor.DoResponse(c, resp, meta)
	if respErr != nil {
		logger.Errorf(ctx, "respErr is not nil: %+v", respErr)
		returnPreConsumedQuota(ctx, preConsumedQuota, meta)
		timing.Finish(c, "error", timing.F("err", respErr.Error.Message))
		recordRelayErrorLog(c, meta, textRequest, respErr.Error.Message)
		return respErr
	}
	// post-consume quota
	go postConsumeQuota(ctx, usage, meta, textRequest, ratio, preConsumedQuota, modelRatio, groupRatio, systemPromptReset)
	timing.Finish(c, "ok")
	return nil
}

// returnPreConsumedQuota 归还预扣额度（个人或企业账本），用于上游/本地报错的退款路径。
func returnPreConsumedQuota(ctx context.Context, preConsumedQuota int64, meta *meta.Meta) {
	if meta.UseOrgQuota {
		billing.ReturnPreConsumedOrgQuota(ctx, preConsumedQuota, meta.TokenId, meta.OrgId, meta.OrgPreConsumedDeducted)
	} else {
		billing.ReturnPreConsumedQuota(ctx, preConsumedQuota, meta.TokenId)
	}
}

func applyPrivateModelDefaults(actualModelName string, textRequest *model.GeneralOpenAIRequest) bool {
	if actualModelName == "qwen3.6-plus" {
		if textRequest.ChatTemplateKwargs == nil {
			textRequest.ChatTemplateKwargs = map[string]interface{}{}
		}
		if _, exists := textRequest.ChatTemplateKwargs["enable_thinking"]; !exists {
			textRequest.ChatTemplateKwargs["enable_thinking"] = false
		}
		return true
	}
	return false
}

func getRequestBody(c *gin.Context, meta *meta.Meta, textRequest *model.GeneralOpenAIRequest, adaptor adaptor.Adaptor) (io.Reader, error) {
	needsPrivateModelDefaults := applyPrivateModelDefaults(meta.ActualModelName, textRequest)
	// 显式缓存注入：模型在后台勾选了"显式缓存"且走 OpenAI 兼容上游时，需解析 body 注入
	// content 块级 cache_control 锚点（阿里云百炼等只认此格式）。注入需解析 body，
	// 故不能走下方 openai 直通分支。仅限 apitype.OpenAI，避免误伤 Ali 原生/Anthropic 格式。
	needCacheInject := meta.APIType == apitype.OpenAI && dbmodel.ModelSupportsExplicitCache(meta.OriginModelName)

	if !needCacheInject &&
		!needsPrivateModelDefaults &&
		!config.EnforceIncludeUsage &&
		meta.APIType == apitype.OpenAI &&
		meta.OriginModelName == meta.ActualModelName &&
		meta.ChannelType != channeltype.Baichuan &&
		meta.ForcedSystemPrompt == "" {
		// no need to convert request for openai
		return c.Request.Body, nil
	}

	// get request body
	var requestBody io.Reader
	convertedRequest, err := adaptor.ConvertRequest(c, meta.Mode, textRequest)
	if err != nil {
		logger.Debugf(c.Request.Context(), "converted request failed: %s\n", err.Error())
		return nil, err
	}
	jsonData, err := json.Marshal(convertedRequest)
	if err != nil {
		logger.Debugf(c.Request.Context(), "converted request json_marshal_failed: %s\n", err.Error())
		return nil, err
	}
	if needCacheInject {
		// fail-open：注入失败则用原始 body，不阻断请求
		if patched, perr := injectExplicitCacheControl(jsonData); perr == nil && patched != nil {
			jsonData = patched
		} else if perr != nil {
			logger.Debugf(c.Request.Context(), "explicit cache inject skipped: %s", perr.Error())
		}
	}
	logger.Debugf(c.Request.Context(), "converted request: \n%s", string(jsonData))
	requestBody = bytes.NewBuffer(jsonData)
	return requestBody, nil
}

// injectExplicitCacheControl 为 OpenAI 兼容请求体注入 content 块级 cache_control 锚点。
// 复刻客户端 provider.ts 的锚点策略：
//  1. 把 string 型 content 统一转成 [{type:text,text}] 数组（阿里云要求 content 为数组）
//  2. 选锚点：第一条 system 消息 + 最后一条非 system 消息
//  3. 在锚点 content 数组的最后一个 text 块上打 cache_control:{type:ephemeral}
//
// 单次请求最多 4 个缓存标记，这里用 2 个（system + 末条）。前缀命中即确定性缓存。
func injectExplicitCacheControl(body []byte) ([]byte, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	rawMessages, ok := payload["messages"].([]interface{})
	if !ok || len(rawMessages) == 0 {
		return nil, nil // 无 messages，不注入
	}

	// 1. string content → 数组
	for _, m := range rawMessages {
		msg, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		if s, ok := msg["content"].(string); ok {
			msg["content"] = []interface{}{
				map[string]interface{}{"type": "text", "text": s},
			}
		}
	}

	// 2. 选锚点：第一条 system + 最后一条非 system
	var anchors []map[string]interface{}
	for _, m := range rawMessages {
		msg, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		if role, _ := msg["role"].(string); role == "system" {
			anchors = append(anchors, msg)
			break
		}
	}
	for i := len(rawMessages) - 1; i >= 0; i-- {
		msg, ok := rawMessages[i].(map[string]interface{})
		if !ok {
			continue
		}
		if role, _ := msg["role"].(string); role != "system" {
			anchors = append(anchors, msg)
			break
		}
	}

	// 3. 在锚点 content 数组的最后一个 text 块打 cache_control
	marked := false
	for _, msg := range anchors {
		content, ok := msg["content"].([]interface{})
		if !ok || len(content) == 0 {
			continue
		}
		last, ok := content[len(content)-1].(map[string]interface{})
		if !ok {
			continue
		}
		if t, _ := last["type"].(string); t == "text" {
			last["cache_control"] = map[string]interface{}{"type": "ephemeral"}
			marked = true
		}
	}
	if !marked {
		return nil, nil // 没打上任何标记，返回 nil 用原 body
	}

	return json.Marshal(payload)
}
