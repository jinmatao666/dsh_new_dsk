package model

import (
	"fmt"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// FreeQuotaIntervalDays 每月免费额度发放间隔(天)
const FreeQuotaIntervalDays = 30

// IssueMonthlyFreeQuotas 扫描并发放每月免费额度
//   - 额度取自「试用包」(个人套餐中 price=0 且启用的套餐),见 GetTrialFreeQuota
//   - 仅发放给"无 active 订阅"的用户
//   - 每个用户独立计时:距上次发放 ≥ FreeQuotaIntervalDays 天(或从未发放)才发放
//   - 发放后将 last_free_quota_at 对齐到今天本地 0 点,便于后续按整数日比较
//
// 注意:本函数被每天 0 点 cron 调用,本身具幂等性,重复调用不会重复发放。
func IssueMonthlyFreeQuotas() error {
	freeQuota := GetTrialFreeQuota()
	if freeQuota <= 0 {
		return nil
	}

	now := time.Now()
	// 今天本地 0 点(用作发放后 last_free_quota_at 的对齐时间)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	// 阈值:距今 ≥ 30 天才允许再次发放(用 todayStart 计算保证按整数日)
	threshold := todayStart.Add(-FreeQuotaIntervalDays * 24 * time.Hour)

	// 找出符合条件的候选用户:
	//   1. 没有任何 status='active' 的订阅(LEFT JOIN 子查询过滤)
	//   2. last_free_quota_at IS NULL 或 last_free_quota_at <= threshold
	//   3. 用户处于启用状态
	type candidate struct {
		Id       int
		Username string
	}
	var candidates []candidate

	err := DB.Raw(`
		SELECT u.id, u.username
		FROM users u
		LEFT JOIN (
			SELECT DISTINCT user_id FROM subscriptions WHERE status = 'active'
		) s ON s.user_id = u.id
		WHERE s.user_id IS NULL
		  AND u.status = ?
		  AND u.account_type = ?
		  AND (u.last_free_quota_at IS NULL OR u.last_free_quota_at <= ?)
	`, UserStatusEnabled, AccountTypePersonal, threshold).Scan(&candidates).Error
	if err != nil {
		return fmt.Errorf("查询每月免费额度候选用户失败: %w", err)
	}

	if len(candidates) == 0 {
		return nil
	}

	logger.SysLogf("每月免费额度: 发现 %d 个候选用户, 单笔额度=%d", len(candidates), freeQuota)

	successCount := 0
	for _, c := range candidates {
		// 使用条件 UPDATE 防止并发重复发放:
		// 仅当 last_free_quota_at 仍为 NULL 或仍 <= threshold 时才更新
		// 发放后 last_free_quota_at 对齐到今天 0 点
		expiresAt := todayStart.Add(FreeQuotaIntervalDays * 24 * time.Hour)
		issued := false
		err := DB.Transaction(func(tx *gorm.DB) error {
			var u User
			query := tx.Select("id", "subscription_quota", "timed_quota_total", "last_free_quota_at", "account_type").
				Where("id = ? AND status = ? AND account_type = ? AND (last_free_quota_at IS NULL OR last_free_quota_at <= ?)", c.Id, UserStatusEnabled, AccountTypePersonal, threshold)
			if !common.UsingSQLite {
				query = query.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := query.First(&u).Error; err != nil {
				if err == gorm.ErrRecordNotFound {
					return nil
				}
				return err
			}
			if u.SubscriptionQuota > 0 {
				if err := tx.Model(&UserTimedQuota{}).
					Where("user_id = ? AND remaining > 0 AND source IN ?", c.Id, subscriptionQuotaSources()).
					Update("remaining", 0).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&User{}).Where("id = ?", c.Id).Updates(map[string]interface{}{
				"subscription_quota": 0,
				"quota":              u.TimedQuotaTotal,
				"last_free_quota_at": todayStart,
			}).Error; err != nil {
				return err
			}
			if err := addUserQuotaLedgerTx(tx, c.Id, freeQuota, TimedQuotaSourceMonthlyFree, "monthly_free", &expiresAt); err != nil {
				return err
			}
			issued = true
			return nil
		})

		if err != nil {
			logger.SysErrorf("用户 %d 发放每月免费额度失败: %v", c.Id, err)
			continue
		}

		if !issued {
			// 已被其他实例/请求抢先发放,跳过
			continue
		}

		// 写日志(LogTypeSystem)
		log := &Log{
			UserId:    c.Id,
			Username:  c.Username,
			CreatedAt: now.Unix(),
			Type:      LogTypeSystem,
			Content:   fmt.Sprintf("每月免费额度赠送 %d", freeQuota),
			Quota:     int(freeQuota),
		}
		if err := LOG_DB.Create(log).Error; err != nil {
			logger.SysErrorf("写入用户 %d 每月免费额度日志失败: %v", c.Id, err)
		}

		successCount++
	}

	logger.SysLogf("每月免费额度: 共发放 %d 笔(候选 %d)", successCount, len(candidates))
	return nil
}
