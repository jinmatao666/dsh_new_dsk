package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// rewardRuleGenModelOption 是存放「AI 生成奖励规则」所用模型名的 option 键。
const rewardRuleGenModelOption = "RewardRuleGenModel"

// rewardRuleGenChannelOption 是存放「AI 生成奖励规则」指定渠道 ID 的 option 键。
// 配置后直接用该渠道（跳过按模型扫描），便于固定到某个已知可用渠道。
const rewardRuleGenChannelOption = "RewardRuleGenChannelId"

// defaultRewardRuleGenModel 是未配置 option 时的默认模型（渠道 11 ds 官方的 deepseek-v4-flash）。
const defaultRewardRuleGenModel = "deepseek-v4-flash"

// defaultRewardRuleGenChannelId 是未配置 option 时的默认渠道 ID。
const defaultRewardRuleGenChannelId = 11

// GetRewardRuleGenModel 读取用于生成奖励规则的模型名（来自 option，未配置则用默认值）。
// 自包含读取 config.OptionMap，不依赖 model 包的大型共享函数。
func GetRewardRuleGenModel() string {
	config.OptionMapRWMutex.RLock()
	v := strings.TrimSpace(config.OptionMap[rewardRuleGenModelOption])
	config.OptionMapRWMutex.RUnlock()
	if v == "" {
		return defaultRewardRuleGenModel
	}
	return v
}

// GetRewardRuleGenChannelId 读取生成奖励规则指定的渠道 ID（来自 option，未配置则用默认渠道）。
// 返回 0 表示不指定渠道（退回按模型扫描）。
func GetRewardRuleGenChannelId() int {
	config.OptionMapRWMutex.RLock()
	v := strings.TrimSpace(config.OptionMap[rewardRuleGenChannelOption])
	config.OptionMapRWMutex.RUnlock()
	if v == "" {
		return defaultRewardRuleGenChannelId
	}
	id, err := strconv.Atoi(v)
	if err != nil || id < 0 {
		return 0
	}
	return id
}

// rewardRuleSystemPrompt 指示模型只输出符合 RewardRule schema 的纯 JSON。
const rewardRuleSystemPrompt = `你是一个把自然语言「达人现金佣金奖励规则」翻译成结构化 JSON 的助手。
你只负责翻译成 JSON，绝不执行任何计算或代码。

请严格只输出一个 JSON 对象（不要 markdown 代码块、不要 ` + "```" + `、不要任何多余文字或解释），字段如下：
- version: 整数，固定填 1
- currency: 字符串，固定填 "CNY"
- mode: 字符串，必须是 "per_unit" | "tiered" | "tiered_per_unit" 之一
    - "per_unit": 每个有效人数固定单价
    - "tiered" / "tiered_per_unit": 按有效人数落入的档位，整体按命中档单价计算（不是累进）
- unit_price: 数字，仅 per_unit 模式需要，表示每个有效人数的奖励（单位：元/人）
- tiers: 数组，仅 tiered / tiered_per_unit 模式需要，每个元素为：
    - min_count: 整数，本档有效人数下限（含）
    - max_count: 整数，本档有效人数上限（含）；填 0 表示无上限
    - unit_price: 数字，落入本档时每个有效人数的单价（单位：元/人）
    - flat_bonus: 数字，落入本档额外固定奖励（单位：元，可省略填 0）
    档位必须按 min_count 升序排列、连续且不重叠（上一档 max_count + 1 == 下一档 min_count），只有最后一档可以无上限（max_count=0）。
- modifiers: 数组（可选，无则填 []），每个元素为：
    - field: "channel" | "influencer_name"
    - equals: 匹配值
    - multiplier: 命中后整体奖励乘以的系数
- note: 字符串，中文人类可读说明，简要复述这条规则

所有金额单位都是「元」（人民币）。奖励主要按「有效人数」(valid_count) 计算。
阶梯模式采用「整体按命中档单价」：有效人数 × 命中档位的单价，不是逐档累进。

示例：
输入："每人5元"
输出：{"version":1,"currency":"CNY","mode":"per_unit","unit_price":5,"note":"每个有效用户奖励5元"}

输入："满100人后每人8元，否则每人5元"
输出：{"version":1,"currency":"CNY","mode":"tiered","tiers":[{"min_count":0,"max_count":99,"unit_price":5,"flat_bonus":0},{"min_count":100,"max_count":0,"unit_price":8,"flat_bonus":0}],"note":"有效人数不足100时每人5元，达到100人及以上时整体每人8元"}`

// generateRewardRuleRequest 是生成接口的请求体。
type generateRewardRuleRequest struct {
	Description string `json:"description"`
}

// stripJSONFences 去掉模型可能误加的 ```json ... ``` 代码块围栏，返回内层纯 JSON 文本。
func stripJSONFences(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	// 去掉起始围栏行（``` 或 ```json）。
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		s = s[idx+1:]
	} else {
		s = strings.TrimPrefix(s, "```")
	}
	// 去掉结尾围栏。
	if idx := strings.LastIndex(s, "```"); idx >= 0 {
		s = s[:idx]
	}
	return strings.TrimSpace(s)
}

// parseRewardRuleFromModelOutput 把模型原始文本解析为 RewardRule 并做合法性校验。
// 纯函数，便于单测：先剥围栏，再 Unmarshal，再 ValidateRewardRule。
func parseRewardRuleFromModelOutput(raw string) (*model.RewardRule, error) {
	cleaned := stripJSONFences(raw)
	if cleaned == "" {
		return nil, errors.New("模型未返回任何内容")
	}
	var rule model.RewardRule
	if err := json.Unmarshal([]byte(cleaned), &rule); err != nil {
		return nil, fmt.Errorf("解析模型输出为 JSON 失败: %s", err.Error())
	}
	if rule.Version == 0 {
		rule.Version = 1
	}
	if rule.Currency == "" {
		rule.Currency = "CNY"
	}
	if err := model.ValidateRewardRule(&rule); err != nil {
		return nil, err
	}
	return &rule, nil
}

// pickRewardRuleGenChannel 选取一个支持指定模型的可用渠道。
// 优先用 option 指定的渠道 ID（固定渠道）；否则走内存缓存（default 分组），
// 再退而求其次扫描所有启用渠道里 Models 含该模型的第一个。无可用渠道返回 error。
func pickRewardRuleGenChannel(modelName string) (*model.Channel, error) {
	// 1. 指定渠道 ID：直接用该渠道（须启用）。
	if channelId := GetRewardRuleGenChannelId(); channelId > 0 {
		if channel, err := model.GetChannelById(channelId, true); err == nil && channel != nil {
			if channel.Status == model.ChannelStatusEnabled {
				return channel, nil
			}
		}
	}
	// 2. 内存缓存命中。
	if channel, err := model.CacheGetRandomSatisfiedChannel("default", modelName, false); err == nil && channel != nil {
		return channel, nil
	}
	// 3. 扫描所有启用渠道，取第一个 Models 包含该模型的。
	channels, err := model.GetAllChannels(0, 0, "all")
	if err != nil {
		return nil, err
	}
	for _, channel := range channels {
		if channel.Status != model.ChannelStatusEnabled {
			continue
		}
		for _, m := range strings.Split(channel.Models, ",") {
			if strings.TrimSpace(m) == modelName {
				return channel, nil
			}
		}
	}
	return nil, fmt.Errorf("没有支持模型 %q 的可用渠道", modelName)
}

// callRewardRuleModel 内部调用 LLM（复刻 channel-test 的假 context + adaptor 流水线），
// 在 user 消息之外额外发送 system prompt，返回 Choices[0].Content 文本。
func callRewardRuleModel(ctx context.Context, channel *model.Channel, modelName, description string) (string, error) {
	request := &relaymodel.GeneralOpenAIRequest{
		Model: modelName,
		Messages: []relaymodel.Message{
			{Role: "system", Content: rewardRuleSystemPrompt},
			{Role: "user", Content: description},
		},
	}
	responseMessage, err, _ := testChannel(ctx, channel, request)
	if err != nil {
		return "", err
	}
	return responseMessage, nil
}

// AdminGenerateRewardRule 处理 POST /api/reward-rule/generate：
// 接收自然语言规则描述，内部调模型翻译成结构化 RewardRule JSON，校验后预览返回（不落库）。
func AdminGenerateRewardRule(c *gin.Context) {
	var req generateRewardRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}
	description := strings.TrimSpace(req.Description)
	if description == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "规则描述不能为空",
		})
		return
	}

	modelName := GetRewardRuleGenModel()
	channel, err := pickRewardRuleGenChannel(modelName)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("当前没有可用于生成奖励规则的渠道（需要支持模型 %q）。请确认渠道 11（或 RewardRuleGenChannelId 指定的渠道）已启用并支持该模型，或调整 RewardRuleGenModel / RewardRuleGenChannelId 配置。", modelName),
		})
		return
	}

	ctx := c.Request.Context()

	// 最多尝试两次：模型偶尔会输出脏 JSON 或不合法规则，重试一次。
	var lastRaw string
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		raw, callErr := callRewardRuleModel(ctx, channel, modelName, description)
		if callErr != nil {
			lastErr = callErr
			continue
		}
		lastRaw = raw
		rule, parseErr := parseRewardRuleFromModelOutput(raw)
		if parseErr != nil {
			lastErr = parseErr
			continue
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": gin.H{
				"rule": rule,
				"note": rule.Note,
			},
		})
		return
	}

	// 两次都失败：返回错误 + 模型原始输出，便于运营排查。
	message := "生成奖励规则失败"
	if lastErr != nil {
		message += ": " + lastErr.Error()
	}
	if lastRaw != "" {
		message += "\n模型原始输出：\n" + lastRaw
	}
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": message,
	})
}

// rewardSettingsResponse 是设置读取接口的 data 结构。
type rewardSettingsResponse struct {
	CrowdId   int               `json:"crowd_id"`
	CrowdName string            `json:"crowd_name"`
	Rule      *model.RewardRule `json:"rule"`
	RuleNote  string            `json:"rule_note"`
}

// AdminGetRewardSettings 处理 GET /api/reward-rule/settings：
// 读取全局有效人群分群 + 奖励规则，回填设置弹窗。
func AdminGetRewardSettings(c *gin.Context) {
	resp := rewardSettingsResponse{}

	resp.CrowdId = model.GetRewardValidCrowdId()
	if resp.CrowdId > 0 {
		if crowd, err := model.GetUserCrowdById(resp.CrowdId); err == nil && crowd != nil {
			resp.CrowdName = crowd.Name
		}
	}

	if ruleJSON := model.GetRewardRuleJSON(); ruleJSON != "" {
		var rule model.RewardRule
		if err := json.Unmarshal([]byte(ruleJSON), &rule); err == nil {
			resp.Rule = &rule
			resp.RuleNote = rule.Note
		} else {
			logger.SysError("奖励规则 JSON 解析失败: " + err.Error())
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": resp})
}

// updateRewardSettingsRequest 是设置保存接口的请求体。
// rule 直接传结构化对象（来自生成接口的预览结果，运营确认后保存）。
type updateRewardSettingsRequest struct {
	CrowdId int               `json:"crowd_id"`
	Rule    *model.RewardRule `json:"rule"`
}

// AdminUpdateRewardSettings 处理 PUT /api/reward-rule/settings：
// 校验后写入全局有效人群分群 ID + 奖励规则 JSON。保存即生效，不回算已发放。
func AdminUpdateRewardSettings(c *gin.Context) {
	var req updateRewardSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}

	// 校验分群存在（0 表示不过滤，允许）。
	if req.CrowdId > 0 {
		crowd, err := model.GetUserCrowdById(req.CrowdId)
		if err != nil || crowd == nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "所选有效人群分群不存在"})
			return
		}
	}

	// 校验并序列化奖励规则（允许为空＝无规则，当期奖励恒 0）。
	ruleJSON := ""
	if req.Rule != nil && req.Rule.Mode != "" {
		if err := model.ValidateRewardRule(req.Rule); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "奖励规则非法: " + err.Error()})
			return
		}
		if req.Rule.Version == 0 {
			req.Rule.Version = 1
		}
		if req.Rule.Currency == "" {
			req.Rule.Currency = "CNY"
		}
		buf, err := json.Marshal(req.Rule)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "奖励规则序列化失败: " + err.Error()})
			return
		}
		ruleJSON = string(buf)
	}

	if err := model.SetRewardValidCrowdId(req.CrowdId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "保存有效人群失败: " + err.Error()})
		return
	}
	if err := model.SetRewardRuleJSON(ruleJSON); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "保存奖励规则失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "保存成功，列表当期奖励将按新规则计算"})
}
