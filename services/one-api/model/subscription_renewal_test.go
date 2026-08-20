package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupRenewalTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &Subscription{}, &UserTimedQuota{}, &Log{}))
	DB = db
	LOG_DB = db
}

// 续期到期日按订阅自身的 PeriodDays 推进:90 天周期的订阅续期后到期日应在 90 天后,
// 而非旧逻辑硬编码的 30 天。同时 PeriodsUsed 自增、积分按 QuotaPerPeriod 重新发放。
func TestProcessRenewal_UsesPeriodDays(t *testing.T) {
	setupRenewalTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 300, Username: "r1", Password: "x", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	sub := &Subscription{
		UserId: 300, PackageId: 1, PackageLevel: 2, BillingCycle: "monthly", Status: "active",
		QuotaPerPeriod: 1000, PeriodDays: 90, PeriodsTotal: 4, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-90 * 24 * time.Hour),
		CurrentPeriodEnd:   now.Add(-time.Hour), // 已到期
		SubscriptionEnd:    now.Add(270 * 24 * time.Hour),
	}
	require.NoError(t, DB.Create(sub).Error)

	require.NoError(t, ProcessUserSubscriptionRenewal(300))

	var updated Subscription
	require.NoError(t, DB.First(&updated, sub.Id).Error)
	assert.Equal(t, "active", updated.Status, "仍有剩余期数应保持 active")
	assert.Equal(t, 2, updated.PeriodsUsed, "已发放期数 +1")

	expected := SubscriptionPeriodEndDays(time.Now(), 90)
	assert.WithinDuration(t, expected, updated.CurrentPeriodEnd, time.Minute, "到期日应按 90 天周期推进")
}

// 末期续期:PeriodsUsed 已达 PeriodsTotal 的订阅应被置为 expired。
func TestProcessRenewal_ExpiresWhenExhausted(t *testing.T) {
	setupRenewalTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 301, Username: "r2", Password: "x", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	sub := &Subscription{
		UserId: 301, PackageId: 1, PackageLevel: 2, BillingCycle: "monthly", Status: "active",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-30 * 24 * time.Hour),
		CurrentPeriodEnd:   now.Add(-time.Hour),
		SubscriptionEnd:    now.Add(-time.Hour),
	}
	require.NoError(t, DB.Create(sub).Error)

	require.NoError(t, ProcessUserSubscriptionRenewal(301))

	var updated Subscription
	require.NoError(t, DB.First(&updated, sub.Id).Error)
	assert.Equal(t, "expired", updated.Status, "期数耗尽应过期")
}

// T0-1:续期 drip 的积分账本 source_ref 必须写订阅关联的真实 order_no,
// 而非历史的聚合字符串 "renewal"——否则多月套餐月2/月3 的积分按 order_no 退款时清不干净(见规则 6.3)。
func TestProcessRenewal_WritesRealOrderNo(t *testing.T) {
	setupRenewalTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 302, Username: "r3", Password: "x", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	sub := &Subscription{
		UserId: 302, PackageId: 1, PackageLevel: 2, BillingCycle: "monthly", Status: "active",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-30 * 24 * time.Hour),
		CurrentPeriodEnd:   now.Add(-time.Hour),
		SubscriptionEnd:    now.Add(60 * 24 * time.Hour),
		OrderNo:            "ORD-T01-XYZ",
	}
	require.NoError(t, DB.Create(sub).Error)

	require.NoError(t, ProcessUserSubscriptionRenewal(302))

	// 续期发放的账本行 source_ref 应等于订阅的真实 order_no
	var rows []UserTimedQuota
	require.NoError(t, DB.Where("user_id = ? AND source = ?", 302, TimedQuotaSourceSubscription).Find(&rows).Error)
	require.Len(t, rows, 1, "续期应发放一笔订阅积分")
	assert.Equal(t, "ORD-T01-XYZ", rows[0].SourceRef, "source_ref 应为真实 order_no,不再是 renewal")
	assert.NotEqual(t, "renewal", rows[0].SourceRef)
	assert.Equal(t, int64(1000), rows[0].Remaining)

	// GetOrderSubscriptionRemaining 应能按真实 order_no 查到该笔续期积分(退款回收前提)
	remaining, err := GetOrderSubscriptionRemaining(302, "ORD-T01-XYZ")
	require.NoError(t, err)
	assert.Equal(t, int64(1000), remaining, "应能按 order_no 查到续期发放的剩余积分")
}
