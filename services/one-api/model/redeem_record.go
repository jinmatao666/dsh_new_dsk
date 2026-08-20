package model

import (
	"errors"

	"github.com/songquanpeng/one-api/common/helper"
	"gorm.io/gorm"
)

// RedeemRecord 达人兑换码兑换归因流水。
//
// 复刻 invite_records 的范式：把"谁兑了谁的码、何时"与发放解耦，专供归因与看板。
// 不存发放额度/到期时间——发放明细在 activity_participations（活动系统自带），
// 看板需要金额时 JOIN activity_participations。
//
// redeemer_user_id 唯一索引实现"每用户全局只兑一个码"的归因侧硬约束；
// 发放侧由兑换人活动的 HasParticipated(once) 兜底，两层一致。
type RedeemRecord struct {
	Id             int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CodeId         int    `json:"code_id" gorm:"index;not null"`                  // 关联 influencer_codes.id
	Code           string `json:"code" gorm:"type:varchar(64);index;not null"`    // 冗余码值，便于查询与导出
	InfluencerName string `json:"influencer_name" gorm:"type:varchar(100);index"` // 冗余达人名，便于聚合
	Channel        string `json:"channel" gorm:"type:varchar(50);index"`          // 冗余渠道
	RedeemerUserId int    `json:"redeemer_user_id" gorm:"uniqueIndex;not null"`   // 兑换用户 ID，全局唯一（每用户只兑一次）
	IssuerUserId   int    `json:"issuer_user_id" gorm:"index;not null"`           // 发码人账户 ID（冗余自兑换码）
	RedeemedAt     int64  `json:"redeemed_at" gorm:"bigint;index"`                // 兑换时间戳
}

// TableName 指定表名。
func (RedeemRecord) TableName() string {
	return "redeem_records"
}

// CreateRedeemRecord 写入一条兑换归因记录。
// 依赖 redeemer_user_id 唯一索引兜底并发重复，重复写入会返回唯一约束错误。
func CreateRedeemRecord(tx *gorm.DB, record *RedeemRecord) error {
	if record.RedeemerUserId == 0 || record.CodeId == 0 {
		return errors.New("兑换人或兑换码不能为空")
	}
	if record.RedeemedAt == 0 {
		record.RedeemedAt = helper.GetTimestamp()
	}
	db := tx
	if db == nil {
		db = DB
	}
	return db.Create(record).Error
}

// HasRedeemRecord 检查用户是否已兑换过任意兑换码（全局一次）。
func HasRedeemRecord(redeemerUserId int) (bool, error) {
	if redeemerUserId == 0 {
		return false, errors.New("兑换人不能为空")
	}
	var count int64
	err := DB.Model(&RedeemRecord{}).
		Where("redeemer_user_id = ?", redeemerUserId).
		Count(&count).Error
	return count > 0, err
}

// CountRedeemByCode 统计某个码的累计兑换人数（实时口径，与 influencer_codes.total_redeemed 冗余计数互校）。
func CountRedeemByCode(codeId int) (int64, error) {
	if codeId == 0 {
		return 0, errors.New("兑换码不能为空")
	}
	var count int64
	err := DB.Model(&RedeemRecord{}).
		Where("code_id = ?", codeId).
		Count(&count).Error
	return count, err
}

// RedeemStatRow 看板按达人/渠道聚合的一行。
type RedeemStatRow struct {
	InfluencerName string `json:"influencer_name"`
	Channel        string `json:"channel"`
	RedeemerCount  int64  `json:"redeemer_count"` // 兑换人数
}

// AggregateRedeemStats 按达人 + 渠道聚合兑换人数，支持时间区间 / 达人 / 渠道过滤。
// startAt/endAt 为 0 时不限。积分金额需调用方再 JOIN activity_participations 取（按 grant_role 分别统计）。
func AggregateRedeemStats(startAt, endAt int64, influencerName, channel string) ([]*RedeemStatRow, error) {
	query := DB.Model(&RedeemRecord{}).
		Select("influencer_name, channel, COUNT(DISTINCT redeemer_user_id) AS redeemer_count").
		Group("influencer_name, channel").
		Order("redeemer_count DESC")
	if startAt > 0 {
		query = query.Where("redeemed_at >= ?", startAt)
	}
	if endAt > 0 {
		query = query.Where("redeemed_at <= ?", endAt)
	}
	if influencerName != "" {
		query = query.Where("influencer_name LIKE ?", "%"+influencerName+"%")
	}
	if channel != "" {
		query = query.Where("channel = ?", channel)
	}
	var rows []*RedeemStatRow
	err := query.Scan(&rows).Error
	return rows, err
}

// RedeemTrendRow 按天兑换趋势的一行（date 为 yyyy-mm-dd）。
type RedeemTrendRow struct {
	Date          string `json:"date"`
	RedeemerCount int64  `json:"redeemer_count"`
}

// AggregateRedeemTrend 按天聚合兑换人数（用于趋势图），可按达人过滤。
// 跨库日期函数差异由 unixDateSQL 统一处理。
func AggregateRedeemTrend(startAt, endAt int64, influencerName string) ([]*RedeemTrendRow, error) {
	dateExpr := unixDateSQL("redeemed_at")
	query := DB.Model(&RedeemRecord{}).
		Select(dateExpr + " AS date, COUNT(DISTINCT redeemer_user_id) AS redeemer_count").
		Group("date").
		Order("date ASC")
	if startAt > 0 {
		query = query.Where("redeemed_at >= ?", startAt)
	}
	if endAt > 0 {
		query = query.Where("redeemed_at <= ?", endAt)
	}
	if influencerName != "" {
		query = query.Where("influencer_name LIKE ?", "%"+influencerName+"%")
	}
	var rows []*RedeemTrendRow
	err := query.Scan(&rows).Error
	return rows, err
}

// ListRedeemRecords 兑换明细分页（看板导出/核账用），支持达人 / 渠道 / 时间过滤。
func ListRedeemRecords(offset, limit int, startAt, endAt int64, influencerName, channel string) ([]*RedeemRecord, int64, error) {
	query := DB.Model(&RedeemRecord{})
	if startAt > 0 {
		query = query.Where("redeemed_at >= ?", startAt)
	}
	if endAt > 0 {
		query = query.Where("redeemed_at <= ?", endAt)
	}
	if influencerName != "" {
		query = query.Where("influencer_name LIKE ?", "%"+influencerName+"%")
	}
	if channel != "" {
		query = query.Where("channel = ?", channel)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []*RedeemRecord
	err := query.Order("redeemed_at DESC").Offset(offset).Limit(limit).Find(&records).Error
	return records, total, err
}
