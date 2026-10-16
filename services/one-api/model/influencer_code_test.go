package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupInfluencerCodeTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	assert.NoError(t, db.AutoMigrate(&InfluencerCode{}))
	assert.NoError(t, db.AutoMigrate(&RedeemRecord{}))

	DB = db
	LOG_DB = db
	common.UsingSQLite = true
}

func TestInfluencerCodeTableName(t *testing.T) {
	assert.Equal(t, "influencer_codes", InfluencerCode{}.TableName())
	assert.Equal(t, "redeem_records", RedeemRecord{}.TableName())
}

func TestCreateInfluencerCode_AutoGenCode(t *testing.T) {
	setupInfluencerCodeTestDB(t)

	ic := &InfluencerCode{IssuerUserId: 100, IssuerPhone: "13800000000", InfluencerName: "张三"}
	assert.NoError(t, CreateInfluencerCode(ic))

	// 自动生成 8 位去易混字符的码
	assert.Len(t, ic.Code, influencerCodeLength)
	for _, c := range ic.Code {
		assert.Contains(t, influencerCodeChars, string(c))
	}
	// 默认启用 + 时间戳已填
	assert.Equal(t, InfluencerCodeStatusEnabled, ic.Status)
	assert.NotZero(t, ic.CreatedTime)
	assert.NotZero(t, ic.UpdatedTime)
}

func TestCreateInfluencerCode_RejectEmptyIssuer(t *testing.T) {
	setupInfluencerCodeTestDB(t)
	err := CreateInfluencerCode(&InfluencerCode{IssuerPhone: "13800000001"})
	assert.Error(t, err)
}

func TestInfluencerCode_PhoneChannelUnique(t *testing.T) {
	setupInfluencerCodeTestDB(t)

	assert.NoError(t, CreateInfluencerCode(&InfluencerCode{IssuerUserId: 1, IssuerPhone: "13800000000", Channel: "douyin"}))
	// 同一手机号 + 同一渠道再建一码应被复合唯一索引拦截
	err := CreateInfluencerCode(&InfluencerCode{IssuerUserId: 1, IssuerPhone: "13800000000", Channel: "douyin"})
	assert.Error(t, err)
	// 同一手机号 + 不同渠道允许各建一码
	assert.NoError(t, CreateInfluencerCode(&InfluencerCode{IssuerUserId: 1, IssuerPhone: "13800000000", Channel: "xiaohongshu"}))
}

func TestUpdateInfluencerCode_IgnoresImmutableFields(t *testing.T) {
	setupInfluencerCodeTestDB(t)

	ic := &InfluencerCode{IssuerUserId: 1, IssuerPhone: "13800000000", Code: "ABCD2345", InfluencerName: "老名"}
	assert.NoError(t, CreateInfluencerCode(ic))

	// 试图改 code / issuer_phone / issuer_user_id，应被忽略；只有运营字段生效
	err := UpdateInfluencerCode(&InfluencerCode{
		Id:             ic.Id,
		Code:           "HACKED99",
		IssuerPhone:    "13900000000",
		IssuerUserId:   999,
		InfluencerName: "新名",
		Status:         InfluencerCodeStatusDisabled,
	})
	assert.NoError(t, err)

	got, err := GetInfluencerCodeById(ic.Id)
	assert.NoError(t, err)
	assert.Equal(t, "ABCD2345", got.Code)           // 未变
	assert.Equal(t, "13800000000", got.IssuerPhone) // 未变
	assert.Equal(t, 1, got.IssuerUserId)            // 未变
	assert.Equal(t, "新名", got.InfluencerName)       // 已更新
	assert.Equal(t, InfluencerCodeStatusDisabled, got.Status)
}

func TestIncrInfluencerCodeRedeemed(t *testing.T) {
	setupInfluencerCodeTestDB(t)

	ic := &InfluencerCode{IssuerUserId: 1, IssuerPhone: "13800000000"}
	assert.NoError(t, CreateInfluencerCode(ic))

	assert.NoError(t, IncrInfluencerCodeRedeemed(nil, ic.Id))
	assert.NoError(t, IncrInfluencerCodeRedeemed(nil, ic.Id))

	got, _ := GetInfluencerCodeById(ic.Id)
	assert.Equal(t, int64(2), got.TotalRedeemed)
}

func TestRedeemRecord_GlobalUniquePerUser(t *testing.T) {
	setupInfluencerCodeTestDB(t)

	// 首次未兑换
	has, err := HasRedeemRecord(500)
	assert.NoError(t, err)
	assert.False(t, has)

	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 1, Code: "ABCD2345", RedeemerUserId: 500, IssuerUserId: 1}))

	has, err = HasRedeemRecord(500)
	assert.NoError(t, err)
	assert.True(t, has)

	// 同一用户再兑（即便换一个码）应被 redeemer_user_id 唯一索引拦截
	err = CreateRedeemRecord(nil, &RedeemRecord{CodeId: 2, Code: "WXYZ6789", RedeemerUserId: 500, IssuerUserId: 2})
	assert.Error(t, err)
}

func TestCountRedeemByCode(t *testing.T) {
	setupInfluencerCodeTestDB(t)

	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 10, Code: "C1", RedeemerUserId: 1, IssuerUserId: 9}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 10, Code: "C1", RedeemerUserId: 2, IssuerUserId: 9}))
	assert.NoError(t, CreateRedeemRecord(nil, &RedeemRecord{CodeId: 11, Code: "C2", RedeemerUserId: 3, IssuerUserId: 8}))

	n, err := CountRedeemByCode(10)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), n)
}
