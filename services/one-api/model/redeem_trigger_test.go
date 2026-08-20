package model

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupRedeemTriggerTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	assert.NoError(t, db.AutoMigrate(&User{}))
	assert.NoError(t, db.AutoMigrate(&Activity{}))
	assert.NoError(t, db.AutoMigrate(&ActivityParticipation{}))
	assert.NoError(t, db.AutoMigrate(&UserTimedQuota{}))
	assert.NoError(t, db.AutoMigrate(&Log{}))
	assert.NoError(t, db.AutoMigrate(&InfluencerCode{}))
	assert.NoError(t, db.AutoMigrate(&RedeemRecord{}))

	DB = db
	LOG_DB = db
	common.UsingSQLite = true
}

// makeRedeemActivity 造一个启用的 redeem 活动（quota 奖励）。
func makeRedeemActivity(t *testing.T, name, grantRole string, amount int64) *Activity {
	a := &Activity{
		Name:         name,
		Status:       "active",
		TriggerType:  "redeem",
		GrantRole:    grantRole,
		GrantLimit:   "once",
		RewardType:   "quota",
		RewardAmount: amount,
	}
	assert.NoError(t, DB.Create(a).Error)
	return a
}

func userQuota(t *testing.T, id int) int64 {
	var u User
	assert.NoError(t, DB.Select("quota").Where("id = ?", id).First(&u).Error)
	return int64(u.Quota)
}

// makeUser 造一个用户，填唯一的 aff_code/access_token 规避唯一索引冲突。
func makeUser(t *testing.T, id, accountType int) {
	suffix := strconv.Itoa(id)
	assert.NoError(t, DB.Create(&User{
		Id:          id,
		Username:    "u" + suffix,
		AccountType: accountType,
		AffCode:     "aff" + suffix,
		AccessToken: "tok" + suffix,
	}).Error)
}

func TestTriggerRedeemActivities_DualGrant(t *testing.T) {
	setupRedeemTriggerTestDB(t)

	// 兑换人 200 / 发码人 100，均为个体账户
	makeUser(t, 200, AccountTypePersonal)
	makeUser(t, 100, AccountTypePersonal)

	makeRedeemActivity(t, "兑换人奖励", "invitee", 500)
	makeRedeemActivity(t, "发码人奖励", "inviter", 300)

	granted, err := TriggerRedeemActivities(context.Background(), 200, 100, "ABCD2345")
	assert.NoError(t, err)
	assert.Equal(t, int64(500), granted) // 回包只含兑换人

	assert.Equal(t, int64(500), userQuota(t, 200)) // 兑换人到账
	assert.Equal(t, int64(300), userQuota(t, 100)) // 发码人到账
}

func TestTriggerRedeemActivities_OnlyRedeemerActivity(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)
	makeUser(t, 100, AccountTypePersonal)

	// 只配兑换人活动 → 发码人不发
	makeRedeemActivity(t, "兑换人奖励", "invitee", 500)

	granted, err := TriggerRedeemActivities(context.Background(), 200, 100, "C")
	assert.NoError(t, err)
	assert.Equal(t, int64(500), granted)
	assert.Equal(t, int64(500), userQuota(t, 200))
	assert.Equal(t, int64(0), userQuota(t, 100))
}

func TestTriggerRedeemActivities_NoActivity(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)
	makeUser(t, 100, AccountTypePersonal)

	// 无任何 redeem 活动 → 兑换成功但不发积分
	granted, err := TriggerRedeemActivities(context.Background(), 200, 100, "C")
	assert.NoError(t, err)
	assert.Equal(t, int64(0), granted)
}

func TestTriggerRedeemActivities_IssuerEnterpriseFailsButRedeemerOk(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	// 兑换人个体、发码人企业（企业账户不持有个人积分，发码人那笔应失败，但兑换人仍到账——非原子）
	makeUser(t, 200, AccountTypePersonal)
	makeUser(t, 100, AccountTypeEnterprise)

	makeRedeemActivity(t, "兑换人奖励", "invitee", 500)
	makeRedeemActivity(t, "发码人奖励", "inviter", 300)

	granted, err := TriggerRedeemActivities(context.Background(), 200, 100, "C")
	assert.NoError(t, err)
	assert.Equal(t, int64(500), granted)
	assert.Equal(t, int64(500), userQuota(t, 200)) // 兑换人到账
	assert.Equal(t, int64(0), userQuota(t, 100))   // 发码人企业账户未到账
}

func TestTriggerRedeemActivities_OnceNoDoubleGrant(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)
	makeUser(t, 100, AccountTypePersonal)
	makeRedeemActivity(t, "兑换人奖励", "invitee", 500)

	// 第一次发放
	_, err := TriggerRedeemActivities(context.Background(), 200, 100, "C")
	assert.NoError(t, err)
	// 第二次：兑换人活动 grant_limit=once，HasParticipated 命中，不重复发
	_, err = TriggerRedeemActivities(context.Background(), 200, 100, "C")
	assert.NoError(t, err)
	assert.Equal(t, int64(500), userQuota(t, 200)) // 仍只有一份
}

// ========== HasGrantableRedeemerActivity（兑换前置闸门）==========

func TestHasGrantableRedeemerActivity_NoActivity(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)

	// 没配任何 redeem 活动 → 不可兑换（修复"忘建活动仍提示成功"）
	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.False(t, ok)
}

func TestHasGrantableRedeemerActivity_HappyPath(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)
	makeRedeemActivity(t, "兑换人奖励", "invitee", 500)

	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.True(t, ok)
}

func TestHasGrantableRedeemerActivity_DisabledActivity(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)

	// 活动停用（status != active）→ 不可兑换（复现用户报的"已禁用活动仍提示成功"）
	a := makeRedeemActivity(t, "兑换人奖励", "invitee", 500)
	assert.NoError(t, DB.Model(&Activity{}).Where("id = ?", a.Id).Update("status", "paused").Error)

	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.False(t, ok)
}

func TestHasGrantableRedeemerActivity_ExpiredActivity(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)

	// 活动 end_time 已过 → 不可兑换（兑换窗口由活动时间控制）
	past := time.Now().Add(-24 * time.Hour)
	a := makeRedeemActivity(t, "兑换人奖励", "invitee", 500)
	assert.NoError(t, DB.Model(&Activity{}).Where("id = ?", a.Id).Update("end_time", &past).Error)

	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.False(t, ok)
}

func TestHasGrantableRedeemerActivity_NotStarted(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)

	// 活动 start_time 未到 → 不可兑换
	future := time.Now().Add(24 * time.Hour)
	a := makeRedeemActivity(t, "兑换人奖励", "invitee", 500)
	assert.NoError(t, DB.Model(&Activity{}).Where("id = ?", a.Id).Update("start_time", &future).Error)

	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.False(t, ok)
}

func TestHasGrantableRedeemerActivity_BudgetExhausted(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)

	// 预算已用完 → 不可兑换
	budget := int64(500)
	a := makeRedeemActivity(t, "兑换人奖励", "invitee", 500)
	assert.NoError(t, DB.Model(&Activity{}).Where("id = ?", a.Id).
		Updates(map[string]interface{}{"total_budget": &budget, "used_budget": int64(500)}).Error)

	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.False(t, ok)
}

func TestHasGrantableRedeemerActivity_OnlyIssuerActivity(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)

	// 只配发码人侧活动 → 兑换人无可领活动，不可兑换
	makeRedeemActivity(t, "发码人奖励", "inviter", 300)

	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.False(t, ok)
}

func TestHasGrantableRedeemerActivity_AlreadyParticipated(t *testing.T) {
	setupRedeemTriggerTestDB(t)
	makeUser(t, 200, AccountTypePersonal)
	makeRedeemActivity(t, "兑换人奖励", "invitee", 500)

	// 已发放过一次（grant_limit=once）→ 该活动对该用户不再可领
	_, err := TriggerRedeemActivities(context.Background(), 200, 100, "C")
	assert.NoError(t, err)

	ok, err := HasGrantableRedeemerActivity(200)
	assert.NoError(t, err)
	assert.False(t, ok)
}
