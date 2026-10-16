package controller

import (
	"fmt"
	"math"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	billingratio "github.com/songquanpeng/one-api/relay/billing/ratio"
)

type UsageReportRequest struct {
	Model            string  `json:"model" binding:"required"`
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	// 缓存 token（prompt cache）：命中读取 / 写入缓存，仅记录用于观测，不参与计费
	CacheReadTokens  int     `json:"cache_read_tokens"`
	CacheWriteTokens int     `json:"cache_write_tokens"`
	QuotaRatio       float64 `json:"quota_ratio"`
}

// ReportUsage handles external usage reporting from Parvis custom providers.
// It records a consume log and deducts user quota, similar to postConsumeQuota
// but for requests that did not go through one-api's relay.
func ReportUsage(c *gin.Context) {
	ctx := c.Request.Context()

	var req UsageReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	tokenId := c.GetInt(ctxkey.TokenId)
	tokenName := c.GetString(ctxkey.TokenName)

	// Default quota_ratio to 1 if not provided or invalid
	quotaRatio := req.QuotaRatio
	if quotaRatio <= 0 {
		// quota_ratio=0 means no charge; just record the log
		if quotaRatio < 0 {
			quotaRatio = 1
		}
	}

	// Get model ratio (uses one-api's configured model ratios)
	// For unknown models, GetModelRatio returns a default of 30
	modelRatio := billingratio.GetModelRatio(req.Model, 0)

	// Get user group and group ratio
	userGroup, _ := model.CacheGetUserGroup(userId)
	groupRatio := billingratio.GetGroupRatio(userGroup)

	// Get completion ratio
	completionRatio := billingratio.GetCompletionRatio(req.Model, 0)

	// Calculate quota: (prompt + completion * completionRatio) * modelRatio * groupRatio * quotaRatio
	ratio := modelRatio * groupRatio * quotaRatio
	var quota int64
	if ratio > 0 {
		quota = int64(math.Ceil((float64(req.PromptTokens) + float64(req.CompletionTokens)*completionRatio) * ratio))
		if quota <= 0 {
			quota = 1
		}
	}

	totalTokens := req.PromptTokens + req.CompletionTokens
	if totalTokens == 0 {
		quota = 0
	}

	// Check user quota before deducting
	if quota > 0 {
		userQuota, err := model.CacheGetUserQuota(ctx, userId)
		if err != nil {
			logger.Error(ctx, "usage report: failed to get user quota: "+err.Error())
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"message": "failed to get user quota",
			})
			return
		}
		if userQuota < quota {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "insufficient quota",
			})
			return
		}

		// Deduct token quota
		err = model.PostConsumeTokenQuota(tokenId, quota)
		if err != nil {
			logger.Error(ctx, "usage report: failed to consume token quota: "+err.Error())
		}

		// Update user quota cache
		err = model.CacheUpdateUserQuota(ctx, userId)
		if err != nil {
			logger.Error(ctx, "usage report: failed to update user quota cache: "+err.Error())
		}

		// Update user used quota and request count
		model.UpdateUserUsedQuotaAndRequestCount(userId, quota)
	}

	// Record consume log (channelId=-1 indicates external/custom provider)
	logContent := fmt.Sprintf("外部上报 | 倍率：%.2f × %.2f × %.2f × %.2f", modelRatio, groupRatio, completionRatio, quotaRatio)
	model.RecordConsumeLog(ctx, &model.Log{
		UserId:           userId,
		ChannelId:        -1,
		PromptTokens:     req.PromptTokens,
		CompletionTokens: req.CompletionTokens,
		CacheReadTokens:  req.CacheReadTokens,
		CacheWriteTokens: req.CacheWriteTokens,
		ModelName:        req.Model,
		TokenName:        tokenName,
		Quota:            int(quota),
		Content:          logContent,
	})

	logger.Infof(ctx, "usage report: user=%d model=%s prompt=%d completion=%d quota=%d ratio=%.2f",
		userId, req.Model, req.PromptTokens, req.CompletionTokens, quota, ratio)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota": quota,
		},
	})
}
