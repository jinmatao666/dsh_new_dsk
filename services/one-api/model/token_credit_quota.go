package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ChangeTokenCreditQuota 在同一事务内调整用户账本和令牌；负数按预扣来源原路退款。
// 返回本次扣减的账本行，退款不会把限时积分变成永久积分。
func ChangeTokenCreditQuota(userID, tokenID int, delta int64, reserved map[int64]int64) (map[int64]int64, error) {
	deducted := map[int64]int64{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		query := tx.Where("id = ?", userID)
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&user).Error; err != nil {
			return err
		}
		var token Token
		query = tx.Where("id = ? AND user_id = ?", tokenID, userID)
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&token).Error; err != nil {
			return err
		}
		if delta > 0 {
			if !token.UnlimitedQuota && token.RemainQuota < delta {
				return errors.New("令牌积分不足")
			}
			var rows []UserTimedQuota
			if err := tx.Where("user_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)", userID, time.Now()).
				Order("CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC").Find(&rows).Error; err != nil {
				return err
			}
			left := delta
			for _, row := range rows {
				take := row.Remaining
				if take > left {
					take = left
				}
				deducted[row.Id] = take
				left -= take
				if left == 0 {
					break
				}
			}
			if left != 0 {
				return errors.New("用户积分不足")
			}
			if err := decreaseUserQuotaTx(tx, userID, delta); err != nil {
				return err
			}
		} else if delta < 0 {
			left := -delta
			ids := make([]int64, 0, len(reserved))
			for id := range reserved {
				ids = append(ids, id)
			}
			var refundRows []UserTimedQuota
			if len(ids) > 0 {
				if err := tx.Where("user_id = ? AND id IN ?", userID, ids).
					Order("CASE WHEN expires_at IS NULL THEN 0 ELSE 1 END, expires_at DESC, id DESC").Find(&refundRows).Error; err != nil {
					return err
				}
			}
			for _, row := range refundRows {
				if left == 0 {
					break
				}
				take := reserved[row.Id]
				if take > left {
					take = left
				}
				if take <= 0 {
					continue
				}
				if row.ExpiresAt == nil || row.ExpiresAt.After(time.Now()) {
					if err := tx.Model(&row).Update("remaining", gorm.Expr("remaining + ?", take)).Error; err != nil {
						return err
					}
					column := "timed_quota_total"
					if isSubscriptionQuotaSource(row.Source) {
						column = "subscription_quota"
					}
					if err := tx.Model(&User{}).Where("id = ?", userID).Updates(map[string]interface{}{
						"quota": gorm.Expr("quota + ?", take), column: gorm.Expr(column+" + ?", take),
					}).Error; err != nil {
						return err
					}
				}
				left -= take
			}
			if left != 0 {
				return errors.New("退款不能超过本次预扣积分")
			}
		}
		if !token.UnlimitedQuota {
			return tx.Model(&Token{}).Where("id = ?", tokenID).Updates(map[string]interface{}{
				"remain_quota": gorm.Expr("remain_quota - ?", delta), "used_quota": gorm.Expr("used_quota + ?", delta), "accessed_time": helper.GetTimestamp(),
			}).Error
		}
		return nil
	})
	if err == nil && common.RedisEnabled {
		if cacheErr := common.RedisDel(fmt.Sprintf("user_quota:%d", userID)); cacheErr != nil {
			logger.SysError("清理积分余额缓存失败：" + cacheErr.Error())
		}
	}
	return deducted, err
}
