package middleware

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/billing"
)

func abortWithMessage(c *gin.Context, statusCode int, message string) {
	c.JSON(statusCode, gin.H{
		"error": gin.H{
			"message": message,
			"type":    "one_api_error",
		},
	})
	c.Abort()
	// request id 只记日志，不暴露给用户
	logger.Error(c.Request.Context(), fmt.Sprintf("%s (request id: %s)", message, c.GetString(helper.RequestIdKey)))

	// 中间件层拦截的错误（鉴权失败/无可用渠道/渠道禁用等）也要进 Log 表，
	// 否则用户报"刚才那条请求失败"时后台搜不到 Request ID。
	// 只对 v1 / v2 业务路径写错误日志，避免污染管理接口。
	if isRelayPath(c.Request.URL.Path) {
		recordMiddlewareErrorLog(c, statusCode, message)
	}
}

// isRelayPath 判断是否是会被用户 Request ID 排查的业务路径。
func isRelayPath(path string) bool {
	return strings.HasPrefix(path, "/v1/") ||
		strings.HasPrefix(path, "/v2/") ||
		strings.HasPrefix(path, "/oneapi/v1/")
}

// recordMiddlewareErrorLog 在 abortWithMessage 路径写一条 Type=LogTypeError 的日志。
// userId / channelId / model 在中间件层可能还没设置好，做空值保护。
// 时间字段：中间件层失败发生在 timing.Start 之前，没法精确知道 elapsed time，
// 这里直接给 0；timing 字段交给 FillLogTimingFromGin 兜底（拿不到就全 0）。
func recordMiddlewareErrorLog(c *gin.Context, statusCode int, message string) {
	userId := c.GetInt(ctxkey.Id)
	channelId := c.GetInt(ctxkey.ChannelId)
	modelName := c.GetString(ctxkey.RequestModel)
	if modelName == "" {
		if mr, err := getRequestModel(c); err == nil {
			modelName = mr
		}
	}
	tokenName := c.GetString(ctxkey.TokenName)
	username := ""
	if userId > 0 {
		username = model.GetUsernameById(userId)
	}
	log := &model.Log{
		UserId:           userId,
		Username:         username,
		ChannelId:        channelId,
		ModelName:        modelName,
		TokenName:        tokenName,
		Quota:            0,
		Content:          truncateMsg(message, 200),
		Type:             model.LogTypeError,
		TimingStatus:     "error",
		TimingStatusCode: statusCode,
		TimingError:      truncateMsg(message, 200),
	}
	billing.FillLogTimingFromGin(c, log)
	model.RecordErrorLog(c.Request.Context(), log)
}

func truncateMsg(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func getRequestModel(c *gin.Context) (string, error) {
	var modelRequest ModelRequest
	err := common.UnmarshalBodyReusable(c, &modelRequest)
	if err != nil {
		return "", fmt.Errorf("common.UnmarshalBodyReusable failed: %w", err)
	}
	if strings.HasPrefix(c.Request.URL.Path, "/v1/moderations") {
		if modelRequest.Model == "" {
			modelRequest.Model = "text-moderation-stable"
		}
	}
	if strings.HasSuffix(c.Request.URL.Path, "embeddings") {
		if modelRequest.Model == "" {
			modelRequest.Model = c.Param("model")
		}
	}
	if strings.HasPrefix(c.Request.URL.Path, "/v1/images/generations") {
		if modelRequest.Model == "" {
			modelRequest.Model = "dall-e-2"
		}
	}
	if strings.HasPrefix(c.Request.URL.Path, "/v1/audio/transcriptions") || strings.HasPrefix(c.Request.URL.Path, "/v1/audio/translations") {
		if modelRequest.Model == "" {
			modelRequest.Model = "whisper-1"
		}
	}
	return modelRequest.Model, nil
}

func isModelInList(modelName string, models string) bool {
	modelList := strings.Split(models, ",")
	for _, model := range modelList {
		if modelName == model {
			return true
		}
	}
	return false
}
