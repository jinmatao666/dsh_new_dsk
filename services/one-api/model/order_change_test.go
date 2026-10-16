package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupOrderChangeTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &UserTimedQuota{}, &Organization{}, &OrgTimedQuota{}))
	DB = db
	common.UsingPostgreSQL = false
	common.UsingSQLite = true
}

// 个人订阅改单：原单发放 100（已用 30，剩 70），改单后剩余设为 50（升/降均测）。
func TestRewriteOrderSubscriptionQuotaTx(t *testing.T) {
	setupOrderChangeTestDB(t)
	user := User{Id: 1, Username: "u1", Email: "u1@e.com", AccessToken: "t1", AffCode: "a1"}
	require.NoError(t, DB.Create(&user).Error)

	// 原订单发放 100 订阅积分，消费 30 → 剩 70
	require.NoError(t, IncreaseUserSubscriptionQuota(1, 100, "ORD1", nil))
	require.NoError(t, DecreaseUserQuota(1, 30))

	remaining, err := GetOrderSubscriptionRemaining(1, "ORD1")
	require.NoError(t, err)
	assert.Equal(t, int64(70), remaining)

	// 改单：本单剩余改写为 50（delta = 50-70 = -20）
	err = DB.Transaction(func(tx *gorm.DB) error {
		return RewriteOrderSubscriptionQuotaTx(tx, 1, "ORD1", 50, nil)
	})
	require.NoError(t, err)

	var u User
	require.NoError(t, DB.First(&u, 1).Error)
	assert.Equal(t, int64(50), u.Quota, "总余额 = 70-20")
	assert.Equal(t, int64(50), u.SubscriptionQuota)

	newRemaining, err := GetOrderSubscriptionRemaining(1, "ORD1")
	require.NoError(t, err)
	assert.Equal(t, int64(50), newRemaining, "旧行清零+新行50")
}

// 企业订单改单：原单充值 200（已用 50，剩 150），改单后剩余设为 300（升级）。
func TestRewriteOrderOrgQuotaTx(t *testing.T) {
	setupOrderChangeTestDB(t)
	org := Organization{Id: 1, Name: "org1"}
	require.NoError(t, DB.Create(&org).Error)

	require.NoError(t, AddOrgTimedQuota(1, 200, OrgTimedQuotaSourceTopup, "ORD2", nil))
	_, err := DecreaseOrgQuotaByLedger(1, 50)
	require.NoError(t, err)

	remaining, err := GetOrderOrgRemaining(1, "ORD2")
	require.NoError(t, err)
	assert.Equal(t, int64(150), remaining)

	// 改单：本单剩余改写为 300（delta = 300-150 = +150）
	err = DB.Transaction(func(tx *gorm.DB) error {
		return RewriteOrderOrgQuotaTx(tx, 1, "ORD2", 300, nil)
	})
	require.NoError(t, err)

	avail, err := GetOrgAvailableQuota(1)
	require.NoError(t, err)
	assert.Equal(t, int64(300), avail)

	var o Organization
	require.NoError(t, DB.First(&o, 1).Error)
	// quota 镜像列：原 200 + delta 150 = 350；used_quota 不变 = 50；available = 300
	assert.Equal(t, int64(350), o.Quota)
	assert.Equal(t, int64(50), o.UsedQuota)
}
