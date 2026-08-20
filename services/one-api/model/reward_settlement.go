package model

import (
	"github.com/songquanpeng/one-api/common/helper"
	"gorm.io/gorm"
)

// RewardSettlement 达人现金返佣结算批次主表。
//
// 一次结算把"当前所有有可结算金额的达人"（或选中的部分达人）打包成一条批次记录 + N 条
// reward_settlement_items 明细。金额一律用"分"(int64)存储，规避浮点误差，展示层 ÷100。
// 已结算记录只增不改，作为财务台账供线下打款对账。
type RewardSettlement struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	BatchNo          string `json:"batch_no" gorm:"type:varchar(32);uniqueIndex"`   // 结算批次号（时间戳+随机）
	InfluencerCount  int    `json:"influencer_count" gorm:"type:int"`               // 本批被结算的达人数
	TotalValidCount  int    `json:"total_valid_count" gorm:"type:int"`              // 本批有效人数合计
	TotalAmountCents int64  `json:"total_amount_cents" gorm:"type:bigint"`          // 本批奖励金额合计（分）
	RuleSnapshot     string `json:"rule_snapshot" gorm:"type:text"`                 // 结算时的奖励规则 JSON 快照
	CrowdId          int    `json:"crowd_id" gorm:"type:int"`                       // 结算时的有效人群分群 ID（快照）
	CrowdName        string `json:"crowd_name" gorm:"type:varchar(255)"`            // 分群名快照（分群可能后续改名）
	IsPartial        bool   `json:"is_partial" gorm:"type:bool"`                    // 是否部分结算（仅对选中达人结算），全量结算为 false
	SettledBy        int    `json:"settled_by" gorm:"type:int"`                     // 操作管理员 ID
	SettledAt        int64  `json:"settled_at" gorm:"type:bigint;index"`            // 结算时间戳
}

// TableName 指定表名。
func (RewardSettlement) TableName() string {
	return "reward_settlements"
}

// RewardSettlementItem 结算批次内按达人的明细行。
//
// 每达人一行，记录本期该达人的有效人数、兑换人数、奖励金额（分）以及"本次结算推进到的游标"
// （该达人本期最大 redeemed_at）。该游标用于界定"当期"——下次计算当期有效人数时只统计
// redeemed_at > MAX(cursor_redeemed_at) 的兑换人，从而实现"结算后当期归零"。
type RewardSettlementItem struct {
	Id               int    `json:"id" gorm:"primaryKey;autoIncrement"`
	SettlementId     int    `json:"settlement_id" gorm:"index"`            // → reward_settlements.id
	CodeId           int    `json:"code_id" gorm:"index"`                  // → influencer_codes.id
	Code             string `json:"code" gorm:"type:varchar(64)"`          // 冗余码值
	IssuerUserId     int    `json:"issuer_user_id" gorm:"index"`           // 达人账户 ID
	IssuerPhone      string `json:"issuer_phone" gorm:"type:varchar(20)"`  // 达人账号（手机号）冗余
	InfluencerName   string `json:"influencer_name" gorm:"type:varchar(100)"` // 达人名冗余
	Channel          string `json:"channel" gorm:"type:varchar(50)"`       // 渠道冗余
	ValidCount       int    `json:"valid_count" gorm:"type:int"`           // 本期该达人有效人数
	RedeemedCount    int    `json:"redeemed_count" gorm:"type:int"`        // 本期该达人兑换人数（参考）
	AmountCents      int64  `json:"amount_cents" gorm:"type:bigint"`       // 本期该达人奖励金额（分）
	CursorRedeemedAt int64  `json:"cursor_redeemed_at" gorm:"type:bigint"` // 本次结算推进到的游标（该达人本期最大 redeemed_at）
}

// TableName 指定表名。
func (RewardSettlementItem) TableName() string {
	return "reward_settlement_items"
}

// IssuerSettleStat 单达人结算汇总（已发放金额 + 结算次数）。
type IssuerSettleStat struct {
	SumAmountCents int64 `json:"sum_amount_cents"`
	SettleCount    int   `json:"settle_count"`
}

// CreateRewardSettlement 在事务内写入结算批次主表 + 明细。
//
// 由 T8 结算接口在事务中调用：插入主表行拿到 s.Id，回填每个 item.SettlementId 后批量插明细。
// 若 tx 为 nil，则自行用 DB.Transaction 包裹，保证主表与明细原子写入。
func CreateRewardSettlement(tx *gorm.DB, s *RewardSettlement, items []*RewardSettlementItem) error {
	if s.SettledAt == 0 {
		s.SettledAt = helper.GetTimestamp()
	}

	write := func(db *gorm.DB) error {
		if err := db.Create(s).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		for _, it := range items {
			it.SettlementId = s.Id
		}
		return db.Create(items).Error
	}

	if tx != nil {
		return write(tx)
	}
	return DB.Transaction(func(txn *gorm.DB) error {
		return write(txn)
	})
}

// ListRewardSettlements 分页列出结算批次（最新优先），返回行 + 总数。
func ListRewardSettlements(offset, limit int) ([]*RewardSettlement, int64, error) {
	var total int64
	if err := DB.Model(&RewardSettlement{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []*RewardSettlement
	err := DB.Model(&RewardSettlement{}).Order("id desc").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, total, err
}

// GetRewardSettlementItems 取某批次的全部达人明细（金额降序）。
func GetRewardSettlementItems(settlementId int) ([]*RewardSettlementItem, error) {
	var items []*RewardSettlementItem
	err := DB.Where("settlement_id = ?", settlementId).
		Order("amount_cents desc").
		Find(&items).Error
	return items, err
}

// ListSettlementItemsByIssuer 取某达人跨批次的全部结算明细（最新优先），支撑"单达人结算历史"。
func ListSettlementItemsByIssuer(issuerUserId int) ([]*RewardSettlementItem, error) {
	var items []*RewardSettlementItem
	err := DB.Where("issuer_user_id = ?", issuerUserId).
		Order("id desc").
		Find(&items).Error
	return items, err
}

// GetSettledCursorsByIssuer 返回 map[issuer_user_id] -> MAX(cursor_redeemed_at)。
// 用作 T3 当期有效人数计算的"已结算游标"。无记录返回空 map（非 nil）。
func GetSettledCursorsByIssuer() (map[int]int64, error) {
	type cursorRow struct {
		IssuerUserId int   `gorm:"column:issuer_user_id"`
		MaxCursor    int64 `gorm:"column:max_cursor"`
	}
	var rows []cursorRow
	err := DB.Model(&RewardSettlementItem{}).
		Select("issuer_user_id, MAX(cursor_redeemed_at) AS max_cursor").
		Group("issuer_user_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]int64, len(rows))
	for _, r := range rows {
		result[r.IssuerUserId] = r.MaxCursor
	}
	return result, nil
}

// GetSettledStatsByIssuer 返回 map[issuer_user_id] -> {已发放金额合计(分), 结算次数}。
// 支撑列表的"已发放奖励"+"结算次数"两列（T7）。无记录返回空 map（非 nil）。
func GetSettledStatsByIssuer() (map[int]*IssuerSettleStat, error) {
	type statRow struct {
		IssuerUserId   int   `gorm:"column:issuer_user_id"`
		SumAmountCents int64 `gorm:"column:sum_amount_cents"`
		SettleCount    int   `gorm:"column:settle_count"`
	}
	var rows []statRow
	err := DB.Model(&RewardSettlementItem{}).
		Select("issuer_user_id, SUM(amount_cents) AS sum_amount_cents, COUNT(*) AS settle_count").
		Group("issuer_user_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]*IssuerSettleStat, len(rows))
	for _, r := range rows {
		result[r.IssuerUserId] = &IssuerSettleStat{
			SumAmountCents: r.SumAmountCents,
			SettleCount:    r.SettleCount,
		}
	}
	return result, nil
}

// GetSettledCursorsByCode 返回 map[code_id] -> MAX(cursor_redeemed_at)。
//
// 兑换码列表按 code 粒度展示（同一手机号不同渠道可有多码），故"当期"游标按 code_id 界定：
// 下次计算某码的当期有效人数时只统计 redeemed_at > MAX(cursor_redeemed_at) 的兑换人。
// 无记录返回空 map（非 nil）。
func GetSettledCursorsByCode() (map[int]int64, error) {
	type cursorRow struct {
		CodeId    int   `gorm:"column:code_id"`
		MaxCursor int64 `gorm:"column:max_cursor"`
	}
	var rows []cursorRow
	err := DB.Model(&RewardSettlementItem{}).
		Select("code_id, MAX(cursor_redeemed_at) AS max_cursor").
		Group("code_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]int64, len(rows))
	for _, r := range rows {
		result[r.CodeId] = r.MaxCursor
	}
	return result, nil
}

// GetSettledStatsByCode 返回 map[code_id] -> {已发放金额合计(分), 结算次数}。
// 支撑列表的"已发放奖励"+"结算次数"两列（T7），按 code 粒度。无记录返回空 map（非 nil）。
func GetSettledStatsByCode() (map[int]*IssuerSettleStat, error) {
	type statRow struct {
		CodeId         int   `gorm:"column:code_id"`
		SumAmountCents int64 `gorm:"column:sum_amount_cents"`
		SettleCount    int   `gorm:"column:settle_count"`
	}
	var rows []statRow
	err := DB.Model(&RewardSettlementItem{}).
		Select("code_id, SUM(amount_cents) AS sum_amount_cents, COUNT(*) AS settle_count").
		Group("code_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]*IssuerSettleStat, len(rows))
	for _, r := range rows {
		result[r.CodeId] = &IssuerSettleStat{
			SumAmountCents: r.SumAmountCents,
			SettleCount:    r.SettleCount,
		}
	}
	return result, nil
}

// SettlementItemWithTime 是带结算时间/批次号的明细行（用于单码结算历史展示）。
type SettlementItemWithTime struct {
	RewardSettlementItem
	BatchNo   string `json:"batch_no"`
	SettledAt int64  `json:"settled_at"`
}

// ListSettlementHistoryByCode 取某码跨批次的结算历史（最新优先），附带批次号与结算时间。
// 供列表"结算次数"点击查看：结算时间 + 金额 + 有效人数。
func ListSettlementHistoryByCode(codeId int) ([]*SettlementItemWithTime, error) {
	var rows []*SettlementItemWithTime
	err := DB.Table("reward_settlement_items AS i").
		Select("i.*, s.batch_no AS batch_no, s.settled_at AS settled_at").
		Joins("JOIN reward_settlements AS s ON s.id = i.settlement_id").
		Where("i.code_id = ?", codeId).
		Order("s.settled_at desc").
		Scan(&rows).Error
	return rows, err
}

// ListSettlementItemsByCode 取某码跨批次的全部结算明细（最新优先），支撑列表"结算次数"点击查看历史。
func ListSettlementItemsByCode(codeId int) ([]*RewardSettlementItem, error) {
	var items []*RewardSettlementItem
	err := DB.Where("code_id = ?", codeId).
		Order("id desc").
		Find(&items).Error
	return items, err
}
