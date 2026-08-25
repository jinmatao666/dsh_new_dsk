package controller

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/relay/constant/role"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/billing"
	billingratio "github.com/songquanpeng/one-api/relay/billing/ratio"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/controller/validator"
	"github.com/songquanpeng/one-api/relay/meta"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

func getInsufficientQuotaMessage() string {
	topUpLink := strings.TrimSpace(config.TopUpLink)
	if topUpLink == "" {
		return "用户额度不足，请联系管理员"
	}
	// 使用 Markdown 链接格式，前端可以识别并转换为可点击链接
	return fmt.Sprintf("用户额度不足，请 [立即充值](%s)", topUpLink)
}
func getAndValidateTextRequest(c *gin.Context, relayMode int) (*relaymodel.GeneralOpenAIRequest, error) {
	textRequest := &relaymodel.GeneralOpenAIRequest{}
	err := common.UnmarshalBodyReusable(c, textRequest)
	if err != nil {
		return nil, err
	}
	if relayMode == relaymode.Moderations && textRequest.Model == "" {
		textRequest.Model = "text-moderation-latest"
	}
	if relayMode == relaymode.Embeddings && textRequest.Model == "" {
		textRequest.Model = c.Param("model")
	}
	err = validator.ValidateTextRequest(textRequest, relayMode)
	if err != nil {
		return nil, err
	}
	return textRequest, nil
}

func getPromptTokens(textRequest *relaymodel.GeneralOpenAIRequest, relayMode int) int {
	switch relayMode {
	case relaymode.ChatCompletions:
		return openai.CountTokenMessages(textRequest.Messages, textRequest.Model)
	case relaymode.Completions:
		return openai.CountTokenInput(textRequest.Prompt, textRequest.Model)
	case relaymode.Moderations:
		return openai.CountTokenInput(textRequest.Input, textRequest.Model)
	}
	return 0
}

func getPreConsumedQuota(textRequest *relaymodel.GeneralOpenAIRequest, promptTokens int, ratio float64) int64 {
	preConsumedTokens := config.PreConsumedQuota + int64(promptTokens)
	if textRequest.MaxTokens != 0 {
		maxTokensCapped := int64(textRequest.MaxTokens)
		if maxTokensCapped > config.PreConsumedMaxTokensCap {
			maxTokensCapped = config.PreConsumedMaxTokensCap
		}
		preConsumedTokens += maxTokensCapped
	}
	return int64(float64(preConsumedTokens) * ratio)
}

func preConsumeQuota(ctx context.Context, textRequest *relaymodel.GeneralOpenAIRequest, promptTokens int, ratio float64, meta *meta.Meta) (int64, *relaymodel.ErrorWithStatusCode) {
	preConsumedQuota := getPreConsumedQuota(textRequest, promptTokens, ratio)

	if meta.UseOrgQuota {
		// 企业模式：四道闸门(总账本/成员累计上限/日月限额/部门预算)统一走公共校验
		if errResp := checkOrgSpendGuards(meta.OrgId, meta.UserId, meta.OrgDeptId, meta.OrgMemberQuotaLimit, preConsumedQuota); errResp != nil {
			return preConsumedQuota, errResp
		}
		// 预扣企业额度:按账本到期顺序消耗,记录 deducted map 供 post 阶段精确退款
		deducted, err := model.DecreaseOrgQuotaByLedger(meta.OrgId, preConsumedQuota)
		if err != nil {
			return preConsumedQuota, openai.ErrorWrapper(err, "decrease_org_quota_failed", http.StatusInternalServerError)
		}
		meta.OrgPreConsumedDeducted = deducted
	} else {
		// 个人模式：现有逻辑不变
		userQuota, err := model.CacheGetUserQuota(ctx, meta.UserId)
		if err != nil {
			return preConsumedQuota, openai.ErrorWrapper(err, "get_user_quota_failed", http.StatusInternalServerError)
		}
		if userQuota-preConsumedQuota < 0 {
			return preConsumedQuota, openai.ErrorWrapper(errors.New(getInsufficientQuotaMessage()), "insufficient_user_quota", http.StatusForbidden)
		}
		err = model.CacheDecreaseUserQuota(meta.UserId, preConsumedQuota)
		if err != nil {
			return preConsumedQuota, openai.ErrorWrapper(err, "decrease_user_quota_failed", http.StatusInternalServerError)
		}
		if userQuota > 100*preConsumedQuota {
			preConsumedQuota = 0
			logger.Info(ctx, fmt.Sprintf("user %d has enough quota %d, trusted and no need to pre-consume", meta.UserId, userQuota))
		}
	}

	if preConsumedQuota > 0 {
		if meta.UseOrgQuota {
			// 企业模式：只扣令牌额度，不检查/扣减用户个人额度
			err := model.PreConsumeTokenQuotaOnly(meta.TokenId, preConsumedQuota)
			if err != nil {
				// token 预扣失败,需要把已扣的企业账本退还,否则会出现"扣了钱却没让请求继续"的状态
				if refundErr := model.RefundOrgQuotaByLedger(meta.OrgId, meta.OrgPreConsumedDeducted); refundErr != nil {
					logger.Error(ctx, "rollback_org_quota_after_token_failure: "+refundErr.Error())
				}
				meta.OrgPreConsumedDeducted = nil
				return preConsumedQuota, openai.ErrorWrapper(err, "pre_consume_token_quota_failed", http.StatusForbidden)
			}
		} else {
			err := model.PreConsumeTokenQuota(meta.TokenId, preConsumedQuota)
			if err != nil {
				return preConsumedQuota, openai.ErrorWrapper(err, "pre_consume_token_quota_failed", http.StatusForbidden)
			}
		}
	}
	return preConsumedQuota, nil
}

func postConsumeQuota(ctx context.Context, usage *relaymodel.Usage, meta *meta.Meta, textRequest *relaymodel.GeneralOpenAIRequest, ratio float64, preConsumedQuota int64, modelRatio float64, groupRatio float64, systemPromptReset bool) {
	if usage == nil {
		logger.Error(ctx, "usage is nil, which is unexpected")
		return
	}
	var quota int64
	completionRatio := billingratio.GetCompletionRatio(textRequest.Model, meta.ChannelType)
	promptTokens := usage.PromptTokens
	completionTokens := usage.CompletionTokens
	quota = int64(math.Ceil((float64(promptTokens) + float64(completionTokens)*completionRatio) * ratio))
	if ratio != 0 && quota <= 0 {
		quota = 1
	}
	totalTokens := promptTokens + completionTokens
	if totalTokens == 0 || completionTokens == 0 {
		quota = 0
	}
	quota = clampQuotaNonNegative(quota)
	quotaDelta := quota - preConsumedQuota
	if meta.UseOrgQuota {
		// 企业模式：只调整令牌额度，不扣用户个人额度
		err := model.PostConsumeTokenQuotaOnly(meta.TokenId, quotaDelta)
		if err != nil {
			logger.Error(ctx, "error consuming token remain quota: "+err.Error())
		}
	} else {
		err := model.PostConsumeTokenQuota(meta.TokenId, quotaDelta)
		if err != nil {
			logger.Error(ctx, "error consuming token remain quota: "+err.Error())
		}
		err = model.CacheUpdateUserQuota(ctx, meta.UserId)
		if err != nil {
			logger.Error(ctx, "error update user quota cache: "+err.Error())
		}
	}

	// 企业模式：更新成员已用额度;企业总额度的 used_quota 已在 DecreaseOrgQuotaByLedger 内同步,
	// 此处仅在 quotaDelta != 0 时调整差额(quotaDelta>0 多扣;<0 退还)。
	orgId := 0
	if meta.UseOrgQuota {
		orgId = meta.OrgId
		// 账本差额 + 成员已用 + 部门用量 + 成员周期计数,统一走公共结算(含 0 下限钳制)
		postConsumeOrgLedger(ctx, meta.OrgId, meta.UserId, meta.OrgDeptId, quota, preConsumedQuota, meta.OrgPreConsumedDeducted)
	}

	logContent := fmt.Sprintf("倍率：%.2f × %.2f × %.2f", modelRatio, groupRatio, completionRatio)
	// 缓存 token（prompt cache）：从上游 usage 的 prompt_tokens_details 提取，仅用于观测缓存命中率，不参与计费。
	// cached_tokens=命中读取（cache_read）；cache_creation_input_tokens=创建写入（cache_write，显式缓存返回）。
	cacheReadTokens := 0
	cacheWriteTokens := 0
	if usage.PromptTokensDetails != nil {
		cacheReadTokens = usage.PromptTokensDetails.CachedTokens
		cacheWriteTokens = usage.PromptTokensDetails.CacheCreationInputTokens
	}
	log := &model.Log{
		UserId:            meta.UserId,
		ChannelId:         meta.ChannelId,
		PromptTokens:      promptTokens,
		CompletionTokens:  completionTokens,
		ModelName:         textRequest.Model,
		TokenName:         meta.TokenName,
		Quota:             int(quota),
		Content:           logContent,
		IsStream:          meta.IsStream,
		ElapsedTime:       helper.CalcElapsedTime(meta.StartTime),
		SystemPromptReset: systemPromptReset,
		OrgId:             orgId,
		CacheReadTokens:   cacheReadTokens,
		CacheWriteTokens:  cacheWriteTokens,
	}
	billing.FillLogTimingFromContext(ctx, log)
	model.RecordConsumeLog(ctx, log)
	model.FinishUserPromptAudit(ctx, "success", "", int(quota), promptTokens, completionTokens, log.ElapsedTime)
	model.UpdateUserUsedQuotaAndRequestCount(meta.UserId, quota)
	model.UpdateChannelUsedQuota(meta.ChannelId, quota)

	// 用户产生实际计费调用后触发「首次请求」类活动（含每日签到：活动配 grant_limit=daily
	// 即每日首次调用发一次；once 则全生命周期首次调用发一次）。发放/去重/预算/资格校验
	// 全部委托活动系统 TriggerActivities → GrantActivityReward，内含 HasParticipated 幂等。
	// 仅个人额度路径触发；企业调用不参与。旁路增益，失败仅记日志、不影响计费主流程。
	if quota > 0 && !meta.UseOrgQuota {
		go func() {
			defer func() { _ = recover() }()
			if err := model.TriggerFirstRequestActivities(context.Background(), meta.UserId); err != nil {
				logger.SysError("触发首次请求活动失败: " + err.Error())
			}
		}()
	}
}

// latestUserQuestion 仅提取本次请求最后一条用户文本，不记录图片附件、工具返回或
// 系统提示，避免把完整会话上下文复制进审计库。
func latestUserQuestion(request *relaymodel.GeneralOpenAIRequest) string {
	if request == nil {
		return ""
	}
	for i := len(request.Messages) - 1; i >= 0; i-- {
		message := request.Messages[i]
		if message.Role == "user" {
			if text := strings.TrimSpace(message.StringContent()); text != "" {
				return text
			}
			// DSH 新会话首条消息会使用 OpenAI Responses 风格的
			// input_text 分段；旧的 StringContent 只识别 type=text，
			// 导致这类首问被审计层误判为空。这里仅为审计补齐文本
			// 提取，不改变转发给上游的原始请求。
			return strings.TrimSpace(extractAuditMessageText(message.Content))
		}
	}
	return ""
}

// extractAuditMessageText 兼容 OpenAI Chat/Responses 两种文本分段格式。
// 只从用户消息中调用，且只取 text/input_text，绝不记录图片或工具结果。
func extractAuditMessageText(value any) string {
	switch content := value.(type) {
	case string:
		return content
	case []any:
		parts := make([]string, 0, len(content))
		for _, item := range content {
			if text := strings.TrimSpace(extractAuditMessageText(item)); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		kind, _ := content["type"].(string)
		switch kind {
		case "text", "input_text":
			text, _ := content["text"].(string)
			return text
		case "":
			// 部分兼容客户端不带 type，直接传 { text: "..." }。
			if text, ok := content["text"].(string); ok {
				return text
			}
			return extractAuditMessageText(content["content"])
		}
	}
	return ""
}

func getMappedModelName(modelName string, mapping map[string]string) (string, bool) {
	if mapping == nil {
		return modelName, false
	}
	mappedModelName := mapping[modelName]
	if mappedModelName != "" {
		return mappedModelName, true
	}
	return modelName, false
}

// scaleDeductedRefund 从预扣 deducted 中按"长到期优先"切出 refund 总额对应的退款 map.
//   - 预扣按"短到期优先"扣减,所以退款时反向(长到期先退),保留短期额度优先消耗的偏好
//   - rowId 顺序由原 map 决定;Go map 无序,但同一笔请求扣减行数有限,误差可接受
func scaleDeductedRefund(deducted map[int64]int64, refund int64) map[int64]int64 {
	if refund <= 0 || len(deducted) == 0 {
		return nil
	}
	// 从大 rowId 向小 rowId 退(rowId 与 expires_at 强相关,后插入的多为较长有效期)
	rowIds := make([]int64, 0, len(deducted))
	for id := range deducted {
		rowIds = append(rowIds, id)
	}
	for i := 0; i < len(rowIds); i++ {
		for j := i + 1; j < len(rowIds); j++ {
			if rowIds[j] > rowIds[i] {
				rowIds[i], rowIds[j] = rowIds[j], rowIds[i]
			}
		}
	}
	result := make(map[int64]int64, len(deducted))
	remain := refund
	for _, id := range rowIds {
		if remain == 0 {
			break
		}
		take := deducted[id]
		if take > remain {
			take = remain
		}
		result[id] = take
		remain -= take
	}
	return result
}

func isErrorHappened(meta *meta.Meta, resp *http.Response) bool {
	if resp == nil {
		if meta.ChannelType == channeltype.AwsClaude {
			return false
		}
		return true
	}
	if resp.StatusCode != http.StatusOK &&
		// replicate return 201 to create a task
		resp.StatusCode != http.StatusCreated {
		return true
	}
	if meta.ChannelType == channeltype.DeepL {
		// skip stream check for deepl
		return false
	}

	if meta.IsStream && strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") &&
		// Even if stream mode is enabled, replicate will first return a task info in JSON format,
		// requiring the client to request the stream endpoint in the task info
		meta.ChannelType != channeltype.Replicate {
		return true
	}
	return false
}

func setSystemPrompt(ctx context.Context, request *relaymodel.GeneralOpenAIRequest, prompt string) (reset bool) {
	if prompt == "" {
		return false
	}
	if len(request.Messages) == 0 {
		return false
	}
	if request.Messages[0].Role == role.System {
		request.Messages[0].Content = prompt
		logger.Infof(ctx, "rewrite system prompt")
		return true
	}
	request.Messages = append([]relaymodel.Message{{
		Role:    role.System,
		Content: prompt,
	}}, request.Messages...)
	logger.Infof(ctx, "add system prompt")
	return true
}

func injectSkillUserMessage(request *relaymodel.GeneralOpenAIRequest, content string) {
	msg := relaymodel.Message{
		Role:    "user",
		Content: content,
	}
	// Insert after system message(s), before the first user/assistant message
	insertIdx := 0
	for i, m := range request.Messages {
		if m.Role == role.System {
			insertIdx = i + 1
		} else {
			break
		}
	}
	request.Messages = append(request.Messages[:insertIdx],
		append([]relaymodel.Message{msg}, request.Messages[insertIdx:]...)...)
}

// truncateMessagesToLimit 截断消息列表，使 token 数不超过 limit
// 保留 system 消息（第一条）和最新消息，从中间删除最老的非 system 消息
func truncateMessagesToLimit(messages []relaymodel.Message, modelName string, limit int) []relaymodel.Message {
	if len(messages) == 0 {
		return messages
	}
	// 找出 system 消息（保留）和非 system 消息
	var systemMsgs []relaymodel.Message
	var otherMsgs []relaymodel.Message
	for _, msg := range messages {
		if msg.Role == role.System {
			systemMsgs = append(systemMsgs, msg)
		} else {
			otherMsgs = append(otherMsgs, msg)
		}
	}
	// 从最老的非 system 消息开始删除，直到 token 数满足 limit
	for len(otherMsgs) > 1 {
		candidate := append(systemMsgs, otherMsgs...)
		tokens := openai.CountTokenMessages(candidate, modelName)
		if tokens <= limit {
			return candidate
		}
		otherMsgs = otherMsgs[1:] // 删除最老的一条
	}
	// 只剩 system + 最后一条消息
	return append(systemMsgs, otherMsgs...)
}
