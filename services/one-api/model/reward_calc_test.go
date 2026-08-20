package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// setupRewardCalcTestDB 为 ComputeCurrentValidCounts 测试准备一个全新的内存库。
// 命名上区别于 setupInfluencerCodeTestDB / setupRewardSettlementTestDB，避免重复定义。
func setupRewardCalcTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	assert.NoError(t, db.AutoMigrate(&User{}))
	assert.NoError(t, db.AutoMigrate(&UserCrowd{}))
	assert.NoError(t, db.AutoMigrate(&RedeemRecord{}))
	assert.NoError(t, db.AutoMigrate(&RewardSettlement{}))
	assert.NoError(t, db.AutoMigrate(&RewardSettlementItem{}))

	DB = db
	LOG_DB = db
	common.UsingSQLite = true
}

func TestComputeCurrentValidCounts_NoCrowd(t *testing.T) {
	setupRewardCalcTestDB(t)

	// code_id 1：3 个兑换人，redeemed_at 10/20/30
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 1, IssuerUserId: 9, RedeemedAt: 10}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 2, IssuerUserId: 9, RedeemedAt: 20}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 3, IssuerUserId: 9, RedeemedAt: 30}))
	// code_id 2：2 个兑换人，redeemed_at 40/50
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 2, Code: "C2", RedeemerUserId: 4, IssuerUserId: 8, RedeemedAt: 40}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 2, Code: "C2", RedeemerUserId: 5, IssuerUserId: 8, RedeemedAt: 50}))

	stats, err := ComputeCurrentValidCounts(0)
	assert.NoError(t, err)
	assert.Len(t, stats, 2)

	s1 := stats[1]
	assert.NotNil(t, s1)
	assert.Equal(t, 3, s1.RedeemedCount)
	assert.Equal(t, 3, s1.ValidCount) // 无分群过滤：valid == redeemed
	assert.Equal(t, int64(30), s1.MaxRedeemedAt)

	s2 := stats[2]
	assert.NotNil(t, s2)
	assert.Equal(t, 2, s2.RedeemedCount)
	assert.Equal(t, 2, s2.ValidCount)
	assert.Equal(t, int64(50), s2.MaxRedeemedAt)
}

func TestComputeCurrentValidCounts_CursorFiltersSettled(t *testing.T) {
	setupRewardCalcTestDB(t)

	// code_id 1：redeemed_at 100/200/300
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 1, IssuerUserId: 9, RedeemedAt: 100}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 2, IssuerUserId: 9, RedeemedAt: 200}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 3, IssuerUserId: 9, RedeemedAt: 300}))

	// 已结算游标推进到 200：redeemed_at<=200 视为已结算，只剩 300 这一条属于当期。
	assert.NoError(t, CreateRewardSettlement(nil,
		&RewardSettlement{BatchNo: "B1"},
		[]*RewardSettlementItem{{CodeId: 1, IssuerUserId: 9, CursorRedeemedAt: 200}},
	))

	stats, err := ComputeCurrentValidCounts(0)
	assert.NoError(t, err)
	assert.Len(t, stats, 1)

	s1 := stats[1]
	assert.NotNil(t, s1)
	assert.Equal(t, 1, s1.RedeemedCount) // 仅 redeemed_at=300 的那条
	assert.Equal(t, 1, s1.ValidCount)
	assert.Equal(t, int64(300), s1.MaxRedeemedAt)
}

func TestComputeCurrentValidCounts_CrowdFilter(t *testing.T) {
	setupRewardCalcTestDB(t)

	// 插入 4 个用户，用 quota 区分：id 1/2 高额度（命中分群），id 3/4 低额度（不命中）。
	// access_token 与 aff_code 均为 uniqueIndex，空串会撞唯一键，故每行给不同值。
	assert.NoError(t, DB.Create(&User{Id: 1, Username: "u1", AccessToken: "tok1", AffCode: "aff1", Quota: 10000, Status: 1}).Error)
	assert.NoError(t, DB.Create(&User{Id: 2, Username: "u2", AccessToken: "tok2", AffCode: "aff2", Quota: 10000, Status: 1}).Error)
	assert.NoError(t, DB.Create(&User{Id: 3, Username: "u3", AccessToken: "tok3", AffCode: "aff3", Quota: 100, Status: 1}).Error)
	assert.NoError(t, DB.Create(&User{Id: 4, Username: "u4", AccessToken: "tok4", AffCode: "aff4", Quota: 100, Status: 1}).Error)

	// 分群规则：quota >= 5000，仅匹配 id 1、2。
	crowd := &UserCrowd{
		Name:  "高额度用户",
		Rules: `{"conditions":[{"field":"quota","operator":">=","value":5000}],"logic":"AND"}`,
	}
	assert.NoError(t, CreateUserCrowd(crowd))

	// 自校验：分群确实只命中 1、2。
	matched, err := crowd.GetMatchedUsersWithPagination(0, 0)
	assert.NoError(t, err)
	assert.ElementsMatch(t, []int{1, 2}, matched)

	// code_id 1：4 个兑换人横跨命中(1,2)与未命中(3,4)。
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 1, IssuerUserId: 9, RedeemedAt: 10}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 2, IssuerUserId: 9, RedeemedAt: 20}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 3, IssuerUserId: 9, RedeemedAt: 30}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "C1", RedeemerUserId: 4, IssuerUserId: 9, RedeemedAt: 40}))

	stats, err := ComputeCurrentValidCounts(crowd.Id)
	assert.NoError(t, err)
	assert.Len(t, stats, 1)

	s1 := stats[1]
	assert.NotNil(t, s1)
	assert.Equal(t, 4, s1.RedeemedCount)      // 当期全部兑换人
	assert.Equal(t, 2, s1.ValidCount)         // 仅命中分群的 id 1、2
	assert.Equal(t, int64(40), s1.MaxRedeemedAt)
}
