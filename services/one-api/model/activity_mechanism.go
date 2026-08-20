package model

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/helper"
)

// ActivityParticipation 活动参与记录
type ActivityParticipation struct {
	Id                int        `json:"id" gorm:"primaryKey;autoIncrement"`
	ActivityId        int        `json:"activity_id" gorm:"not null;index:idx_activity_user"`
	UserId            int        `json:"user_id" gorm:"not null;index:idx_activity_user;index:idx_user_id"`
	ParticipationTime time.Time  `json:"participation_time" gorm:"not null;index:idx_participation_time"`
	RewardStatus      string     `json:"reward_status" gorm:"type:varchar(20);not null;default:'pending';index:idx_reward_status"` // pending, granted, rejected
	RewardGrantedAt   *time.Time `json:"reward_granted_at"`
	RewardAmount      int64      `json:"reward_amount" gorm:"not null;default:0"`
	TriggerData       string     `json:"trigger_data" gorm:"type:text"` // JSON格式存储触发数据
	Remark            string     `json:"remark" gorm:"type:text"`
	CreatedAt         time.Time  `json:"created_at" gorm:"autoCreateTime;index:idx_created_at"`
	UpdatedAt         time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

// TableName 指定表名
func (ActivityParticipation) TableName() string {
	return "activity_participations"
}

// UserCrowd 用户人群定义
type UserCrowd struct {
	Id               int        `json:"id" gorm:"primaryKey;autoIncrement"`
	Name             string     `json:"name" gorm:"type:varchar(100);not null;index"`
	Description      string     `json:"description" gorm:"type:text"`
	Rules            string     `json:"rules" gorm:"type:text;not null"` // JSON格式存储分群规则
	UserCount        int        `json:"user_count" gorm:"default:0"`
	IsDynamic        bool       `json:"is_dynamic" gorm:"default:true;index"`
	LastCalculatedAt *time.Time `json:"last_calculated_at"`
	CreatedAt        time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt        time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

// TableName 指定表名
func (UserCrowd) TableName() string {
	return "user_crowds"
}

// HasParticipated 检查用户是否已参与活动（根据限领规则）
// grantLimit: "once" - 只能参与一次, "daily" - 每日可参与, "unlimited" - 不限制
func HasParticipated(activityId, userId int, grantLimit string) (bool, error) {
	if activityId == 0 || userId == 0 {
		return false, errors.New("活动ID或用户ID不能为空")
	}

	switch grantLimit {
	case "once":
		// 检查是否存在任何记录
		var count int64
		err := DB.Model(&ActivityParticipation{}).
			Where("activity_id = ? AND user_id = ?", activityId, userId).
			Count(&count).Error
		if err != nil {
			return false, err
		}
		return count > 0, nil

	case "daily":
		// 检查今天是否有记录
		now := time.Now()
		startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		endOfDay := startOfDay.Add(24 * time.Hour)

		var count int64
		err := DB.Model(&ActivityParticipation{}).
			Where("activity_id = ? AND user_id = ? AND participation_time >= ? AND participation_time < ?",
				activityId, userId, startOfDay, endOfDay).
			Count(&count).Error
		if err != nil {
			return false, err
		}
		return count > 0, nil

	case "unlimited":
		// 不限制
		return false, nil

	default:
		return false, fmt.Errorf("未知的限领规则: %s", grantLimit)
	}
}

// RecordParticipation 记录用户参与并发放积分（每次发放独立新增一行台账）。
// 使用事务确保数据一致性。
func RecordParticipation(activityId, userId int, amount int64, expiresAt *time.Time) error {
	return recordParticipationCore(activityId, userId, amount, expiresAt, false)
}

// RecordParticipationMerged 与 RecordParticipation 相同，但积分走「合并到单条永久批次」的台账写入，
// 用于高频重复发放（如每日签到），避免 user_timed_quotas 逐日膨胀。
// participation 记录仍逐次新增（保留每日签到明细与去重），仅台账积分行合并。
// 仅在 expiresAt=nil（永久积分）时真正合并；有到期时间时退化为普通新增。
func RecordParticipationMerged(activityId, userId int, amount int64, expiresAt *time.Time) error {
	return recordParticipationCore(activityId, userId, amount, expiresAt, true)
}

func recordParticipationCore(activityId, userId int, amount int64, expiresAt *time.Time, mergeLedger bool) error {
	if activityId == 0 || userId == 0 {
		return errors.New("活动ID或用户ID不能为空")
	}
	if amount < 0 {
		return errors.New("发放金额不能为负数")
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		// 创建参与记录（逐次新增，用于每日去重与明细留存）
		now := time.Now()
		participation := &ActivityParticipation{
			ActivityId:        activityId,
			UserId:            userId,
			ParticipationTime: now,
			RewardStatus:      "granted",
			RewardGrantedAt:   &now,
			RewardAmount:      amount,
		}

		// 如果金额为0，设置状态为 pending
		if amount == 0 {
			participation.RewardStatus = "pending"
			participation.RewardGrantedAt = nil
		}

		if err := tx.Create(participation).Error; err != nil {
			return fmt.Errorf("创建参与记录失败: %w", err)
		}

		// 如果有积分要发放，增加用户积分
		if amount > 0 {
			// 获取活动信息用于备注
			var activity Activity
			if err := tx.Select("name").Where("id = ?", activityId).First(&activity).Error; err != nil {
				return fmt.Errorf("获取活动信息失败: %w", err)
			}

			// 发放积分（走定时积分账本，expiresAt=nil 表示永久）
			// mergeLedger=true 时合并到同 source_ref 的单条永久批次（签到防膨胀）
			sourceRef := fmt.Sprintf("activity_%d", activityId)
			var ledgerErr error
			if mergeLedger {
				ledgerErr = addOrMergeUserQuotaLedgerTx(tx, userId, amount, TimedQuotaSourceActivity, sourceRef, expiresAt)
			} else {
				ledgerErr = addUserQuotaLedgerTx(tx, userId, amount, TimedQuotaSourceActivity, sourceRef, expiresAt)
			}
			if ledgerErr != nil {
				return fmt.Errorf("发放积分失败: %w", ledgerErr)
			}

			// 更新活动的已使用预算
			if err := tx.Model(&Activity{}).Where("id = ?", activityId).
				Update("used_budget", gorm.Expr("used_budget + ?", amount)).Error; err != nil {
				return fmt.Errorf("更新活动预算失败: %w", err)
			}

			// 记录日志（写入 Quota 额度，便于账户动态展示额度变更）
			logContent := fmt.Sprintf("参与活动「%s」获得 %s", activity.Name, common.LogQuota(amount))
			if err := recordLogTxWithQuota(tx, userId, LogTypeSystem, logContent, int(amount)); err != nil {
				// 日志失败不影响主流程，只记录错误
				return fmt.Errorf("记录日志失败: %w", err)
			}
		}

		return nil
	})
}

// GetParticipationStats 获取活动参与统计
func GetParticipationStats(activityId int) (map[string]interface{}, error) {
	if activityId == 0 {
		return nil, errors.New("活动ID不能为空")
	}

	stats := make(map[string]interface{})

	// 总参与人数（去重）
	var totalUsers int64
	err := DB.Model(&ActivityParticipation{}).
		Where("activity_id = ?", activityId).
		Distinct("user_id").
		Count(&totalUsers).Error
	if err != nil {
		return nil, fmt.Errorf("查询总参与人数失败: %w", err)
	}
	stats["total_users"] = totalUsers

	// 总参与次数
	var totalParticipations int64
	err = DB.Model(&ActivityParticipation{}).
		Where("activity_id = ?", activityId).
		Count(&totalParticipations).Error
	if err != nil {
		return nil, fmt.Errorf("查询总参与次数失败: %w", err)
	}
	stats["total_participations"] = totalParticipations

	// 总发放积分
	var totalGranted int64
	err = DB.Model(&ActivityParticipation{}).
		Where("activity_id = ? AND reward_status = ?", activityId, "granted").
		Select("COALESCE(SUM(reward_amount), 0)").
		Scan(&totalGranted).Error
	if err != nil {
		return nil, fmt.Errorf("查询总发放积分失败: %w", err)
	}
	stats["total_granted"] = totalGranted

	// 今日参与人数
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var todayUsers int64
	err = DB.Model(&ActivityParticipation{}).
		Where("activity_id = ? AND participation_time >= ?", activityId, startOfDay).
		Distinct("user_id").
		Count(&todayUsers).Error
	if err != nil {
		return nil, fmt.Errorf("查询今日参与人数失败: %w", err)
	}
	stats["today_users"] = todayUsers

	return stats, nil
}

// GetUserParticipations 获取用户的参与记录
func GetUserParticipations(userId int, limit int) ([]*ActivityParticipation, error) {
	if userId == 0 {
		return nil, errors.New("用户ID不能为空")
	}

	var participations []*ActivityParticipation
	query := DB.Where("user_id = ?", userId).Order("participation_time DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}
	err := query.Find(&participations).Error
	return participations, err
}

// GetActivityParticipations 获取活动的参与记录
func GetActivityParticipations(activityId int, offset, limit int) ([]*ActivityParticipation, error) {
	if activityId == 0 {
		return nil, errors.New("活动ID不能为空")
	}

	var participations []*ActivityParticipation
	err := DB.Where("activity_id = ?", activityId).
		Order("participation_time DESC").
		Offset(offset).
		Limit(limit).
		Find(&participations).Error
	return participations, err
}

// recordLogTx 在事务中记录日志（内部辅助函数）
func recordLogTx(tx *gorm.DB, userId int, logType int, content string) error {
	log := &Log{
		UserId:    userId,
		Username:  GetUsernameById(userId),
		CreatedAt: helper.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	return tx.Create(log).Error
}

// recordLogTxWithQuota 与 recordLogTx 相同，但额外写入 Quota 额度，
// 用于积分发放类日志，便于「账户动态」展示额度变更。
func recordLogTxWithQuota(tx *gorm.DB, userId int, logType int, content string, quota int) error {
	log := &Log{
		UserId:    userId,
		Username:  GetUsernameById(userId),
		CreatedAt: helper.GetTimestamp(),
		Type:      logType,
		Content:   content,
		Quota:     quota,
	}
	return tx.Create(log).Error
}

// ===== 每日签到（复用「首次请求」活动 + grant_limit=daily）=====
//
// 签到不是独立开关，而是后台「活动管理」里一个 trigger_type=first_request 的活动：
//   - grant_limit=daily → 每自然日首次实际计费调用时发放一次（= 每日签到）
//   - grant_limit=once  → 全生命周期首次调用发一次（= 首调奖励）
// 发放/去重/预算/资格校验统一走活动系统（TriggerActivities → GrantActivityReward）。

// ActivityTriggerSignIn 签到活动的触发类型，与后台活动表单「首次请求」选项一致。
const ActivityTriggerSignIn = "first_request"

// CheckinStats 每日签到状态与统计（用户侧展示用）。
type CheckinStats struct {
	Enabled        bool  `json:"enabled"`         // 是否存在生效的签到活动
	ActivityId     int   `json:"activity_id"`     // 生效签到活动ID
	RewardCredits  int64 `json:"reward_credits"`  // 每次签到奖励积分（= reward_amount / QuotaPerUnit）
	TodayClaimed   bool  `json:"today_claimed"`   // 今日是否已签到
	ContinuousDays int   `json:"continuous_days"` // 连续签到天数（含今天；未签但昨天签过仍连续）
	TotalDays      int   `json:"total_days"`      // 累计签到天数
}

// GetActiveSignInActivity 取当前生效的「每日签到」活动（trigger=first_request 且 grant_limit=daily）。
// 无生效签到活动返回 (nil, nil)。仅供前端签到卡片展示状态用；实际发放走 TriggerActivities。
//
// 只认 grant_limit=daily 的 first_request 活动为签到——once 类是「首调奖励」，不在签到卡展示。
func GetActiveSignInActivity() (*Activity, error) {
	activities, err := GetActiveActivitiesByTrigger(ActivityTriggerSignIn)
	if err != nil {
		return nil, err
	}
	for _, activity := range activities {
		if activity.GrantLimit == "daily" {
			return activity, nil
		}
	}
	return nil, nil
}

// GetCheckinStats 计算用户在指定签到活动下的签到状态。
//
// 切天以服务器本地自然日为界（与 HasParticipated daily 同口径）。
// continuous_days：最近一次签到须为今天或昨天，否则连续中断记 0；再逐日向前累计。
func GetCheckinStats(activity *Activity, userId int) (*CheckinStats, error) {
	if activity == nil || activity.Id == 0 || userId == 0 {
		return nil, errors.New("活动或用户ID不能为空")
	}
	perUnit := config.QuotaPerUnit
	if perUnit <= 0 {
		perUnit = 1
	}
	stats := &CheckinStats{
		Enabled:       true,
		ActivityId:    activity.Id,
		RewardCredits: int64(float64(activity.RewardAmount) / perUnit),
	}

	claimed, err := HasParticipated(activity.Id, userId, "daily")
	if err != nil {
		return nil, err
	}
	stats.TodayClaimed = claimed

	// 取全部签到时间（倒序），按本地自然日去重
	var times []time.Time
	if err := DB.Model(&ActivityParticipation{}).
		Where("activity_id = ? AND user_id = ?", activity.Id, userId).
		Order("participation_time DESC").
		Pluck("participation_time", &times).Error; err != nil {
		return nil, err
	}
	days := make([]string, 0, len(times))
	seen := make(map[string]bool, len(times))
	for _, t := range times {
		d := t.In(time.Local).Format("2006-01-02")
		if !seen[d] {
			seen[d] = true
			days = append(days, d) // participation_time DESC → days 亦按日期降序
		}
	}
	stats.TotalDays = len(days)
	stats.ContinuousDays = countContinuousDays(days)
	return stats, nil
}

// countContinuousDays 由「按日期降序去重的签到日列表」计算连续签到天数。
func countContinuousDays(descDays []string) int {
	if len(descDays) == 0 {
		return 0
	}
	loc := time.Local
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	latest, err := time.ParseInLocation("2006-01-02", descDays[0], loc)
	if err != nil {
		return 0
	}
	// 最近一次签到在前天以前 → 连续已断
	if int(today.Sub(latest).Hours()/24) > 1 {
		return 0
	}
	count := 1
	prev := latest
	for i := 1; i < len(descDays); i++ {
		d, err := time.ParseInLocation("2006-01-02", descDays[i], loc)
		if err != nil {
			break
		}
		if int(prev.Sub(d).Hours()/24) == 1 {
			count++
			prev = d
		} else {
			break
		}
	}
	return count
}

// TriggerFirstRequestActivities 用户产生实际计费调用后触发「首次请求」类活动（含每日签到）。
//
// 直接委托通用活动系统 TriggerActivities("first_request")，由其内部 MatchUser + HasParticipated
// 完成资格与去重（daily=每日一次；once=全周期一次），发放走 GrantActivityReward。
// 不设内存闸门：去重完全交给 DB（HasParticipated），保证清库后可立即重签、无需重启进程；
// 代价是每次计费调用多一两次带索引查询，位于 relay 计费成功后的异步 goroutine，不影响主链路。
// 失败仅记日志、不影响计费主流程。
func TriggerFirstRequestActivities(ctx context.Context, userId int) error {
	if userId == 0 {
		return nil
	}
	return TriggerActivities(ctx, ActivityTriggerSignIn, userId)
}
