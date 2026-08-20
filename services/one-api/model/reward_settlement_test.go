package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupRewardSettlementTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	assert.NoError(t, db.AutoMigrate(&RewardSettlement{}))
	assert.NoError(t, db.AutoMigrate(&RewardSettlementItem{}))

	DB = db
	LOG_DB = db
	common.UsingSQLite = true
}

func TestRewardSettlementTableName(t *testing.T) {
	assert.Equal(t, "reward_settlements", RewardSettlement{}.TableName())
	assert.Equal(t, "reward_settlement_items", RewardSettlementItem{}.TableName())
}

func TestCreateRewardSettlement_WritesMasterAndItems(t *testing.T) {
	setupRewardSettlementTestDB(t)

	s := &RewardSettlement{
		BatchNo:          "B202606290001",
		InfluencerCount:  2,
		TotalValidCount:  30,
		TotalAmountCents: 15000,
		RuleSnapshot:     `{"mode":"per_unit","unit_price":5}`,
		CrowdId:          7,
		CrowdName:        "活跃用户",
		IsPartial:        false,
		SettledBy:        1,
	}
	items := []*RewardSettlementItem{
		{CodeId: 11, Code: "C1", IssuerUserId: 100, IssuerPhone: "13800000000", InfluencerName: "张三", Channel: "douyin", ValidCount: 20, RedeemedCount: 25, AmountCents: 10000, CursorRedeemedAt: 1700},
		{CodeId: 12, Code: "C2", IssuerUserId: 101, IssuerPhone: "13800000001", InfluencerName: "李四", Channel: "xhs", ValidCount: 10, RedeemedCount: 12, AmountCents: 5000, CursorRedeemedAt: 1800},
	}

	assert.NoError(t, CreateRewardSettlement(nil, s, items))

	// 主表拿到自增 ID，settled_at 自动填充
	assert.NotZero(t, s.Id)
	assert.NotZero(t, s.SettledAt)

	// 明细 SettlementId 已回填为主表 Id
	for _, it := range items {
		assert.Equal(t, s.Id, it.SettlementId)
		assert.NotZero(t, it.Id)
	}

	// 落库可读
	got, err := GetRewardSettlementItems(s.Id)
	assert.NoError(t, err)
	assert.Len(t, got, 2)
	// amount_cents desc，金额大的在前
	assert.Equal(t, int64(10000), got[0].AmountCents)
	assert.Equal(t, int64(5000), got[1].AmountCents)
}

func TestCreateRewardSettlement_PreservesGivenSettledAt(t *testing.T) {
	setupRewardSettlementTestDB(t)

	s := &RewardSettlement{BatchNo: "B-fixed", SettledAt: 1234567890}
	assert.NoError(t, CreateRewardSettlement(nil, s, nil))
	assert.Equal(t, int64(1234567890), s.SettledAt)
}

func TestListRewardSettlements_Pagination(t *testing.T) {
	setupRewardSettlementTestDB(t)

	for i := 0; i < 5; i++ {
		s := &RewardSettlement{BatchNo: "B" + string(rune('A'+i)), TotalAmountCents: int64(i * 100)}
		assert.NoError(t, CreateRewardSettlement(nil, s, nil))
	}

	rows, total, err := ListRewardSettlements(0, 2)
	assert.NoError(t, err)
	assert.Equal(t, int64(5), total)
	assert.Len(t, rows, 2)
	// id desc：最新（最大 id）优先
	assert.True(t, rows[0].Id > rows[1].Id)

	// 第二页
	page2, _, err := ListRewardSettlements(2, 2)
	assert.NoError(t, err)
	assert.Len(t, page2, 2)
	assert.True(t, rows[1].Id > page2[0].Id)
}

func TestGetRewardSettlementItems_ScopedToBatch(t *testing.T) {
	setupRewardSettlementTestDB(t)

	s1 := &RewardSettlement{BatchNo: "B1"}
	assert.NoError(t, CreateRewardSettlement(nil, s1, []*RewardSettlementItem{
		{CodeId: 1, IssuerUserId: 100, AmountCents: 300},
		{CodeId: 2, IssuerUserId: 101, AmountCents: 100},
	}))
	s2 := &RewardSettlement{BatchNo: "B2"}
	assert.NoError(t, CreateRewardSettlement(nil, s2, []*RewardSettlementItem{
		{CodeId: 3, IssuerUserId: 100, AmountCents: 200},
	}))

	items1, err := GetRewardSettlementItems(s1.Id)
	assert.NoError(t, err)
	assert.Len(t, items1, 2)
	// amount_cents desc
	assert.Equal(t, int64(300), items1[0].AmountCents)

	items2, err := GetRewardSettlementItems(s2.Id)
	assert.NoError(t, err)
	assert.Len(t, items2, 1)
	assert.Equal(t, 3, items2[0].CodeId)
}

func TestListSettlementItemsByIssuer_AcrossBatchesNewestFirst(t *testing.T) {
	setupRewardSettlementTestDB(t)

	// 同一达人 100 在两批结算各有一行；另有达人 101 不应混入
	s1 := &RewardSettlement{BatchNo: "B1"}
	assert.NoError(t, CreateRewardSettlement(nil, s1, []*RewardSettlementItem{
		{CodeId: 1, IssuerUserId: 100, AmountCents: 1000, CursorRedeemedAt: 1700},
		{CodeId: 2, IssuerUserId: 101, AmountCents: 500, CursorRedeemedAt: 1700},
	}))
	s2 := &RewardSettlement{BatchNo: "B2"}
	assert.NoError(t, CreateRewardSettlement(nil, s2, []*RewardSettlementItem{
		{CodeId: 1, IssuerUserId: 100, AmountCents: 2000, CursorRedeemedAt: 1900},
	}))

	items, err := ListSettlementItemsByIssuer(100)
	assert.NoError(t, err)
	assert.Len(t, items, 2)
	// id desc：第二批（更晚写入，id 更大）在前
	assert.Equal(t, int64(2000), items[0].AmountCents)
	assert.Equal(t, int64(1000), items[1].AmountCents)
}

func TestGetSettledCursorsByIssuer(t *testing.T) {
	setupRewardSettlementTestDB(t)

	// 空表返回空 map（非 nil）
	empty, err := GetSettledCursorsByIssuer()
	assert.NoError(t, err)
	assert.NotNil(t, empty)
	assert.Len(t, empty, 0)

	s1 := &RewardSettlement{BatchNo: "B1"}
	assert.NoError(t, CreateRewardSettlement(nil, s1, []*RewardSettlementItem{
		{IssuerUserId: 100, CursorRedeemedAt: 1700},
		{IssuerUserId: 101, CursorRedeemedAt: 1650},
	}))
	s2 := &RewardSettlement{BatchNo: "B2"}
	assert.NoError(t, CreateRewardSettlement(nil, s2, []*RewardSettlementItem{
		{IssuerUserId: 100, CursorRedeemedAt: 1900}, // 100 的最大游标推进到 1900
	}))

	cursors, err := GetSettledCursorsByIssuer()
	assert.NoError(t, err)
	assert.Equal(t, int64(1900), cursors[100])
	assert.Equal(t, int64(1650), cursors[101])
}

func TestGetSettledStatsByIssuer(t *testing.T) {
	setupRewardSettlementTestDB(t)

	// 空表返回空 map（非 nil）
	empty, err := GetSettledStatsByIssuer()
	assert.NoError(t, err)
	assert.NotNil(t, empty)
	assert.Len(t, empty, 0)

	s1 := &RewardSettlement{BatchNo: "B1"}
	assert.NoError(t, CreateRewardSettlement(nil, s1, []*RewardSettlementItem{
		{IssuerUserId: 100, AmountCents: 1000},
		{IssuerUserId: 101, AmountCents: 500},
	}))
	s2 := &RewardSettlement{BatchNo: "B2"}
	assert.NoError(t, CreateRewardSettlement(nil, s2, []*RewardSettlementItem{
		{IssuerUserId: 100, AmountCents: 2000},
	}))

	stats, err := GetSettledStatsByIssuer()
	assert.NoError(t, err)
	// 达人 100：两次结算，合计 3000 分
	assert.Equal(t, int64(3000), stats[100].SumAmountCents)
	assert.Equal(t, 2, stats[100].SettleCount)
	// 达人 101：一次结算，500 分
	assert.Equal(t, int64(500), stats[101].SumAmountCents)
	assert.Equal(t, 1, stats[101].SettleCount)
}
