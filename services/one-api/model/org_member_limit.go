package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

// OrgMemberLimit 是企业成员的日/月用量限额.独立于 org_members,按 (org_id,user_id) 唯一.
//   - DailyCap / MonthlyCap: -1=不限,0=禁止消费,>0=对应周期上限
//   - DailyUsed / MonthlyUsed: 当前周期已用,扣费 post-consume 时累加
//   - DailyResetAt / MonthlyResetAt: 下次清零时间;cron 到点把对应 used 归零并顺延
//   - 资金仍来自企业总账本;此表只做"花多少"的节流闸门
type OrgMemberLimit struct {
	Id             int        `json:"id" gorm:"primaryKey"`
	OrgId          int        `json:"org_id" gorm:"uniqueIndex:uk_limit_org_user;not null;comment:企业ID"`
	UserId         int        `json:"user_id" gorm:"uniqueIndex:uk_limit_org_user;not null;comment:用户ID"`
	DailyCap       int64      `json:"daily_cap" gorm:"type:bigint;default:-1;comment:日上限 -1=不限 0=禁用"`
	MonthlyCap     int64      `json:"monthly_cap" gorm:"type:bigint;default:-1;comment:月上限 -1=不限 0=禁用"`
	DailyUsed      int64      `json:"daily_used" gorm:"type:bigint;default:0;comment:当日已用"`
	MonthlyUsed    int64      `json:"monthly_used" gorm:"type:bigint;default:0;comment:当月已用"`
	DailyResetAt   *time.Time `json:"daily_reset_at" gorm:"comment:下次日重置时间"`
	MonthlyResetAt *time.Time `json:"monthly_reset_at" gorm:"comment:下次月重置时间"`
	CreatedAt      time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (OrgMemberLimit) TableName() string {
	return "org_member_limits"
}

// nextDailyReset 返回今天之后的下一个 0 点.
func nextDailyReset(from time.Time) time.Time {
	y, m, d := from.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, from.Location()).AddDate(0, 0, 1)
}

// nextMonthlyReset 返回下个月 1 号 0 点.
func nextMonthlyReset(from time.Time) time.Time {
	y, m, _ := from.Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, from.Location()).AddDate(0, 1, 0)
}

// SetOrgMemberLimit upsert 成员限额.daily/monthly cap 为 -1 表示不限.
func SetOrgMemberLimit(orgId, userId int, dailyCap, monthlyCap int64) error {
	if orgId == 0 || userId == 0 {
		return errors.New("org_id / user_id 不能为空")
	}
	if dailyCap < -1 {
		dailyCap = -1
	}
	if monthlyCap < -1 {
		monthlyCap = -1
	}
	now := time.Now()
	dReset := nextDailyReset(now)
	mReset := nextMonthlyReset(now)

	var existing OrgMemberLimit
	err := DB.Where("org_id = ? AND user_id = ?", orgId, userId).First(&existing).Error
	if err == nil {
		return DB.Model(&OrgMemberLimit{}).Where("id = ?", existing.Id).
			Updates(map[string]interface{}{
				"daily_cap":   dailyCap,
				"monthly_cap": monthlyCap,
			}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	row := OrgMemberLimit{
		OrgId:          orgId,
		UserId:         userId,
		DailyCap:       dailyCap,
		MonthlyCap:     monthlyCap,
		DailyResetAt:   &dReset,
		MonthlyResetAt: &mReset,
	}
	if err := DB.Create(&row).Error; err != nil {
		return err
	}
	// GORM 的 default:-1 tag 会把"显式设为 0"(禁止消费)当作未赋值而覆盖成 -1(不限).
	// 插入后再用 map 强制回写 cap 列(map 会写入字面 0),保住 daily_cap=0 语义.
	return DB.Model(&OrgMemberLimit{}).Where("id = ?", row.Id).
		Updates(map[string]interface{}{
			"daily_cap":   dailyCap,
			"monthly_cap": monthlyCap,
		}).Error
}

// GetOrgMemberLimit 返回成员限额(不存在返回 nil,表示无限额).
func GetOrgMemberLimit(orgId, userId int) (*OrgMemberLimit, error) {
	var row OrgMemberLimit
	err := DB.Where("org_id = ? AND user_id = ?", orgId, userId).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// GetOrgMemberLimits 批量取企业成员限额,返回 user_id -> limit 映射,供前端列表合并展示.
func GetOrgMemberLimits(orgId int) (map[int]*OrgMemberLimit, error) {
	var rows []OrgMemberLimit
	if err := DB.Where("org_id = ?", orgId).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[int]*OrgMemberLimit, len(rows))
	for i := range rows {
		result[rows[i].UserId] = &rows[i]
	}
	return result, nil
}

// CheckOrgMemberLimit 在 pre-consume 时校验该成员本次扣费是否会突破日/月限额.
//   - 无限额行 / cap=-1 直接放行
//   - cap=0 直接拒绝
//   - 已过重置点的计数视为 0(cron 未及时跑也不会误伤)
func CheckOrgMemberLimit(orgId, userId int, quota int64) error {
	if quota <= 0 {
		return nil
	}
	limit, err := GetOrgMemberLimit(orgId, userId)
	if err != nil {
		return err
	}
	if limit == nil {
		return nil
	}
	now := time.Now()
	dailyUsed := limit.DailyUsed
	if limit.DailyResetAt != nil && !limit.DailyResetAt.After(now) {
		dailyUsed = 0
	}
	monthlyUsed := limit.MonthlyUsed
	if limit.MonthlyResetAt != nil && !limit.MonthlyResetAt.After(now) {
		monthlyUsed = 0
	}
	if limit.DailyCap == 0 {
		return errors.New("该成员已被禁止消费(日限额=0)")
	}
	if limit.MonthlyCap == 0 {
		return errors.New("该成员已被禁止消费(月限额=0)")
	}
	if limit.DailyCap > 0 && dailyUsed+quota > limit.DailyCap {
		return errors.New("超出该成员当日额度上限")
	}
	if limit.MonthlyCap > 0 && monthlyUsed+quota > limit.MonthlyCap {
		return errors.New("超出该成员当月额度上限")
	}
	return nil
}

// IncrOrgMemberUsed 扣费 post-consume 时累加成员日/月计数.
//   - 无限额行直接跳过(不为未设限额的成员凭空建行)
//   - 并发安全:先做条件重置(WHERE reset_at<=now,幂等,仅首个并发者命中),
//     再用 gorm.Expr 原子自增.避免"读-改-写绝对值"在并发下丢失更新导致计数少计.
func IncrOrgMemberUsed(tx *gorm.DB, orgId, userId int, quota int64) error {
	if quota == 0 {
		return nil
	}
	db := tx
	if db == nil {
		db = DB
	}
	// 仅在该成员确有限额行时才累加;不凭空建行
	var cnt int64
	if err := db.Model(&OrgMemberLimit{}).Where("org_id = ? AND user_id = ?", orgId, userId).Count(&cnt).Error; err != nil {
		return err
	}
	if cnt == 0 {
		return nil
	}
	now := time.Now()
	// 1) 条件重置:已过日重置点的行原子归零并顺延(WHERE 保证只命中一次)
	nextDaily := nextDailyReset(now)
	if err := db.Model(&OrgMemberLimit{}).
		Where("org_id = ? AND user_id = ? AND daily_reset_at IS NOT NULL AND daily_reset_at <= ?", orgId, userId, now).
		Updates(map[string]interface{}{"daily_used": 0, "daily_reset_at": &nextDaily}).Error; err != nil {
		return err
	}
	nextMonthly := nextMonthlyReset(now)
	if err := db.Model(&OrgMemberLimit{}).
		Where("org_id = ? AND user_id = ? AND monthly_reset_at IS NOT NULL AND monthly_reset_at <= ?", orgId, userId, now).
		Updates(map[string]interface{}{"monthly_used": 0, "monthly_reset_at": &nextMonthly}).Error; err != nil {
		return err
	}
	// 2) 原子自增;退款(quota<0)时 GREATEST 兜底不低于 0
	if quota > 0 {
		return db.Model(&OrgMemberLimit{}).Where("org_id = ? AND user_id = ?", orgId, userId).
			Updates(map[string]interface{}{
				"daily_used":   gorm.Expr("daily_used + ?", quota),
				"monthly_used": gorm.Expr("monthly_used + ?", quota),
			}).Error
	}
	return db.Model(&OrgMemberLimit{}).Where("org_id = ? AND user_id = ?", orgId, userId).
		Updates(map[string]interface{}{
			"daily_used":   greatestZeroExpr("daily_used", -quota),
			"monthly_used": greatestZeroExpr("monthly_used", -quota),
		}).Error
}

// ResetOrgMemberDailyUsed 由每日 0 点 cron 调用,把到期的日计数归零并顺延重置点.幂等.
func ResetOrgMemberDailyUsed() error {
	now := time.Now()
	next := nextDailyReset(now)
	return DB.Model(&OrgMemberLimit{}).
		Where("daily_reset_at IS NOT NULL AND daily_reset_at <= ?", now).
		Updates(map[string]interface{}{
			"daily_used":     0,
			"daily_reset_at": &next,
		}).Error
}

// ResetOrgMemberMonthlyUsed 由每月 1 号 cron 调用,把到期的月计数归零并顺延重置点.幂等.
func ResetOrgMemberMonthlyUsed() error {
	now := time.Now()
	next := nextMonthlyReset(now)
	return DB.Model(&OrgMemberLimit{}).
		Where("monthly_reset_at IS NOT NULL AND monthly_reset_at <= ?", now).
		Updates(map[string]interface{}{
			"monthly_used":     0,
			"monthly_reset_at": &next,
		}).Error
}

// DeleteOrgMemberLimit 成员转出企业时清理其限额行.
func DeleteOrgMemberLimit(tx *gorm.DB, orgId, userId int) error {
	db := tx
	if db == nil {
		db = DB
	}
	return db.Where("org_id = ? AND user_id = ?", orgId, userId).Delete(&OrgMemberLimit{}).Error
}
