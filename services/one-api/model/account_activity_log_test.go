package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// setupAccountActivityLogTestDB 准备账户动态日志测试所需的表
func setupAccountActivityLogTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	assert.NoError(t, db.AutoMigrate(&User{}))
	assert.NoError(t, db.AutoMigrate(&Log{}))
	assert.NoError(t, db.AutoMigrate(&Subscription{}))
	assert.NoError(t, db.AutoMigrate(&MemberIdentity{}))
	assert.NoError(t, db.AutoMigrate(&UserCoupon{}))

	DB = db
	LOG_DB = db
	common.UsingSQLite = true
}

// TestGrantMemberIdentity_WritesActivityLog 验证发放会员身份会写入账户动态日志
func TestGrantMemberIdentity_WritesActivityLog(t *testing.T) {
	setupAccountActivityLogTestDB(t)

	user := &User{Username: "vipuser", Password: "hash", DisplayName: "VIP"}
	assert.NoError(t, DB.Create(user).Error)

	identity := &MemberIdentity{Name: "黄金会员", PackageId: 1, PackageLevel: 2, Enabled: true}
	assert.NoError(t, DB.Create(identity).Error)

	err := GrantMemberIdentityToUser(user.Id, identity.Id, 30, "test")
	assert.NoError(t, err)

	// 账户动态应能查到这条会员发放记录
	logs, total, err := GetUserActivityLogs(user.Id, 0, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, LogTypeSystem, logs[0].Type)
	assert.Contains(t, logs[0].Content, "黄金会员")
	assert.Contains(t, logs[0].Content, "30")
	assert.NotZero(t, logs[0].CreatedAt)
}

// TestAddUserCouponTx_WritesActivityLog 验证单个优惠券发放会写入账户动态日志
func TestAddUserCouponTx_WritesActivityLog(t *testing.T) {
	setupAccountActivityLogTestDB(t)

	user := &User{Username: "couponuser", Password: "hash", DisplayName: "C"}
	assert.NoError(t, DB.Create(user).Error)

	// 折扣券 0.8 → "8.0 折"
	err := DB.Transaction(func(tx *gorm.DB) error {
		return AddUserCouponTx(tx, user.Id, CouponTypeDiscount, 0.8, "test", nil)
	})
	assert.NoError(t, err)

	logs, total, err := GetUserActivityLogs(user.Id, 0, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, LogTypeSystem, logs[0].Type)
	assert.Contains(t, logs[0].Content, "折")
	assert.NotZero(t, logs[0].CreatedAt)
}

// TestBatchAddUserCoupons_WritesActivityLogPerUser 验证批量发券为每个用户写日志
func TestBatchAddUserCoupons_WritesActivityLogPerUser(t *testing.T) {
	setupAccountActivityLogTestDB(t)

	u1 := &User{Username: "b1", Password: "h", DisplayName: "b1", AccessToken: "tok-b1", AffCode: "aff-b1"}
	u2 := &User{Username: "b2", Password: "h", DisplayName: "b2", AccessToken: "tok-b2", AffCode: "aff-b2"}
	assert.NoError(t, DB.Create(u1).Error)
	assert.NoError(t, DB.Create(u2).Error)

	// 抵扣券 ¥10.50
	err := BatchAddUserCoupons([]int{u1.Id, u2.Id}, CouponTypeDeduction, 10.5, "test", nil)
	assert.NoError(t, err)

	for _, uid := range []int{u1.Id, u2.Id} {
		logs, total, err := GetUserActivityLogs(uid, 0, 10)
		assert.NoError(t, err)
		assert.Equal(t, int64(1), total)
		assert.Contains(t, logs[0].Content, "抵扣券")
		assert.Contains(t, logs[0].Content, "10.50")
	}

	// 优惠券实际已写入
	var couponCount int64
	assert.NoError(t, DB.Model(&UserCoupon{}).Count(&couponCount).Error)
	assert.Equal(t, int64(2), couponCount)
}

// TestGetUserActivityLogs_ExcludesBehaviorRecords 验证登录/注册等行为日志不会出现在权益变更记录中，
// 且活动名/赠送文案含「登录」「注册」字样的权益变更不会被误排除。
func TestGetUserActivityLogs_ExcludesBehaviorRecords(t *testing.T) {
	setupAccountActivityLogTestDB(t)

	user := &User{Username: "loginuser", Password: "hash", DisplayName: "L"}
	assert.NoError(t, DB.Create(user).Error)

	// 登录、注册：LogTypeBehavior 行为日志，不属于权益变更，应被过滤
	assert.NoError(t, DB.Create(&Log{UserId: user.Id, Type: LogTypeBehavior, Content: "通过手机号登录", CreatedAt: 100}).Error)
	assert.NoError(t, DB.Create(&Log{UserId: user.Id, Type: LogTypeBehavior, Content: "通过手机号注册", CreatedAt: 101}).Error)
	// 真正的权益变更：会员时长，应保留
	assert.NoError(t, DB.Create(&Log{UserId: user.Id, Type: LogTypeSystem, Content: "获得「黄金会员」会员 30 天", CreatedAt: 102}).Error)
	// 活动名含「注册」字样的权益变更：旧实现会被 content LIKE '%注册%' 误杀，现应保留
	assert.NoError(t, DB.Create(&Log{UserId: user.Id, Type: LogTypeSystem, Quota: 10000000, Content: "参与活动「新注册用户奖励-长期」获得 10000.00 积分", CreatedAt: 103}).Error)
	assert.NoError(t, DB.Create(&Log{UserId: user.Id, Type: LogTypeSystem, Content: "新用户注册赠送 5000.00 积分", CreatedAt: 104}).Error)

	logs, total, err := GetUserActivityLogs(user.Id, 0, 10)
	assert.NoError(t, err)
	assert.Equal(t, int64(3), total)
	// 不应包含任何登录/注册行为日志
	for _, l := range logs {
		assert.NotEqual(t, "通过手机号登录", l.Content)
		assert.NotEqual(t, "通过手机号注册", l.Content)
	}
}
