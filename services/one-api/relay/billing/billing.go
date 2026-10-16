package billing

import (
	"context"
	"fmt"

	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

func ReturnPreConsumedQuota(ctx context.Context, preConsumedQuota int64, tokenId int) {
	if preConsumedQuota != 0 {
		go func(ctx context.Context) {
			err := model.PostConsumeTokenQuota(tokenId, -preConsumedQuota)
			if err != nil {
				logger.Error(ctx, "error return pre-consumed quota: "+err.Error())
			}
		}(ctx)
	}
}

func ReturnPreConsumedOrgQuota(ctx context.Context, preConsumedQuota int64, tokenId int, orgId int, deducted map[int64]int64) {
	if preConsumedQuota != 0 {
		go func(ctx context.Context) {
			// 企业模式：只退还令牌额度，不操作用户个人额度
			err := model.PostConsumeTokenQuotaOnly(tokenId, -preConsumedQuota)
			if err != nil {
				logger.Error(ctx, "error return pre-consumed quota: "+err.Error())
			}
		}(ctx)
		if orgId > 0 && len(deducted) > 0 {
			go func() {
				if err := model.RefundOrgQuotaByLedger(orgId, deducted); err != nil {
					logger.SysError("refund org pre-consumed ledger failed: " + err.Error())
				}
			}()
		}
	}
}

func PostConsumeQuota(ctx context.Context, tokenId int, quotaDelta int64, totalQuota int64, userId int, channelId int, modelRatio float64, groupRatio float64, modelName string, tokenName string) {
	err := model.PostConsumeTokenQuota(tokenId, quotaDelta)
	if err != nil {
		logger.SysError("error consuming token remain quota: " + err.Error())
	}
	err = model.CacheUpdateUserQuota(ctx, userId)
	if err != nil {
		logger.SysError("error update user quota cache: " + err.Error())
	}
	if totalQuota != 0 {
		logContent := fmt.Sprintf("倍率：%.2f × %.2f", modelRatio, groupRatio)
		log := &model.Log{
			UserId:           userId,
			ChannelId:        channelId,
			PromptTokens:     int(totalQuota),
			CompletionTokens: 0,
			ModelName:        modelName,
			TokenName:        tokenName,
			Quota:            int(totalQuota),
			Content:          logContent,
		}
		FillLogTimingFromContext(ctx, log)
		model.RecordConsumeLog(ctx, log)
		model.UpdateUserUsedQuotaAndRequestCount(userId, totalQuota)
		model.UpdateChannelUsedQuota(channelId, totalQuota)
	}
	if totalQuota <= 0 {
		logger.Error(ctx, fmt.Sprintf("totalQuota consumed is %d, something is wrong", totalQuota))
	}
}
