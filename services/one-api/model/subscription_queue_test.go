package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupQueueTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &Subscription{}, &UserTimedQuota{}, &Log{}))
	DB = db
	LOG_DB = db
}

// T0-3:队列序按购买顺序递增分配;无订阅时从 1 起,后续在当前最大值上 +1。
func TestNextSubscriptionQueueSeq(t *testing.T) {
	setupQueueTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 400, Username: "q1", Password: "x", AccessToken: "tok400", AffCode: "aff400", AccountType: AccountTypePersonal}).Error)

	// 空队列从 1 起
	seq, err := NextSubscriptionQueueSeqTx(DB, 400)
	require.NoError(t, err)
	assert.Equal(t, 1, seq)

	now := time.Now()
	require.NoError(t, DB.Create(&Subscription{
		UserId: 400, PackageId: 1, PackageLevel: 1, BillingCycle: "monthly", Status: SubscriptionStatusActive,
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(30 * 24 * time.Hour),
		OrderNo: "ORD-Q1", QueueSeq: 1,
	}).Error)

	seq, err = NextSubscriptionQueueSeqTx(DB, 400)
	require.NoError(t, err)
	assert.Equal(t, 2, seq, "已有 1 条 queue_seq=1 时下一序应为 2")

	// 另一个用户互不影响
	require.NoError(t, DB.Create(&User{Id: 401, Username: "q2", Password: "x", AccessToken: "tok401", AffCode: "aff401", AccountType: AccountTypePersonal}).Error)
	seq, err = NextSubscriptionQueueSeqTx(DB, 401)
	require.NoError(t, err)
	assert.Equal(t, 1, seq, "不同用户队列序独立")
}

// T0-3:冻结相关字段可正常落库与读取(active 时 frozen_at 为空)。
func TestSubscriptionFreezeFieldsPersist(t *testing.T) {
	setupQueueTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 402, Username: "q3", Password: "x", AffCode: "aff402", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	frozenAt := now.Add(-time.Hour)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 402, PackageId: 1, PackageLevel: 1, BillingCycle: "monthly", Status: SubscriptionStatusFrozen,
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(30 * 24 * time.Hour),
		OrderNo: "ORD-Q3", QueueSeq: 2,
		FrozenAt: &frozenAt, FrozenRemainDays: 60,
	}).Error)

	var got Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-Q3").First(&got).Error)
	assert.Equal(t, SubscriptionStatusFrozen, got.Status)
	assert.Equal(t, 2, got.QueueSeq)
	assert.Equal(t, 60, got.FrozenRemainDays)
	require.NotNil(t, got.FrozenAt)
	assert.WithinDuration(t, frozenAt, *got.FrozenAt, time.Second)
}
