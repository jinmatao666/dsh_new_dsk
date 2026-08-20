package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupQueueModelTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &Subscription{}, &UserTimedQuota{}, &Log{}, &Order{}))
	DB = db
	LOG_DB = db
}

// T1-1：ResolveActiveSubscription 取等级最高且生效中的块为当前身份,排除当前块后取下一个待生效块。
func TestResolveActiveSubscription(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 500, Username: "rs1", Password: "x", AccessToken: "tok500", AffCode: "aff500", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	// 低等级 active(生效中)+ 高等级 active(生效中)：当前应取高等级
	require.NoError(t, DB.Create(&Subscription{
		UserId: 500, PackageLevel: 1, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(30 * 24 * time.Hour),
		OrderNo: "ORD-LO", QueueSeq: 1,
	}).Error)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 500, PackageLevel: 2, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 2000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(15 * 24 * time.Hour),
		OrderNo: "ORD-HI", QueueSeq: 2,
	}).Error)

	view, err := ResolveActiveSubscription(500)
	require.NoError(t, err)
	require.NotNil(t, view.Current)
	assert.Equal(t, 2, view.Current.PackageLevel, "当前生效应为最高等级块")
	assert.Equal(t, "ORD-HI", view.Current.OrderNo)
	require.NotNil(t, view.Next)
	assert.Equal(t, "ORD-LO", view.Next.OrderNo, "下一个待生效应为低等级块")
}

// T1-2：冻结低等级 active 块——升级时被压住的块停时钟。
func TestFreezeActiveSubscriptionsBelow(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 501, Username: "fz1", Password: "x", AccessToken: "tok501", AffCode: "aff501", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	require.NoError(t, DB.Create(&Subscription{
		UserId: 501, PackageLevel: 1, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(30 * 24 * time.Hour),
		OrderNo: "ORD-A", QueueSeq: 1,
	}).Error)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return FreezeActiveSubscriptionsBelowTx(tx, 501, 2, now)
	}))

	var got Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-A").First(&got).Error)
	assert.Equal(t, SubscriptionStatusFrozen, got.Status, "低等级块应被冻结")
	require.NotNil(t, got.FrozenAt)
}

// T1-2：高等级块到期续期耗尽后,恢复下一个 frozen 块,从恢复时刻重排 drip。
func TestRenewalRestoresFrozenBlock(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 502, Username: "rf1", Password: "x", AccessToken: "tok502", AffCode: "aff502", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	// 高等级块：已到期且期数耗尽 → 续期时应过期退场
	require.NoError(t, DB.Create(&Subscription{
		UserId: 502, PackageLevel: 2, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 2000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-30 * 24 * time.Hour), CurrentPeriodEnd: now.Add(-time.Hour),
		OrderNo: "ORD-HI2", QueueSeq: 2,
	}).Error)
	// 低等级块：冻结排队,还剩 2 期未 drip
	frozenAt := now.Add(-15 * 24 * time.Hour)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 502, PackageLevel: 1, Status: SubscriptionStatusFrozen, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-45 * 24 * time.Hour), CurrentPeriodEnd: now.Add(-15 * 24 * time.Hour),
		OrderNo: "ORD-LO2", QueueSeq: 1, FrozenAt: &frozenAt,
	}).Error)

	require.NoError(t, ProcessUserSubscriptionRenewal(502))

	var hi Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-HI2").First(&hi).Error)
	assert.Equal(t, SubscriptionStatusExpired, hi.Status, "高等级块期数耗尽应过期")

	var lo Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-LO2").First(&lo).Error)
	assert.Equal(t, SubscriptionStatusActive, lo.Status, "低等级块应被恢复为生效")
	assert.Equal(t, 2, lo.PeriodsUsed, "恢复时 drip 一期,已发期数 +1")
	assert.WithinDuration(t, SubscriptionPeriodEndDays(time.Now(), 30), lo.CurrentPeriodEnd, time.Minute, "应从恢复时刻重排到期日")
	require.Nil(t, lo.FrozenAt, "恢复后 frozen_at 应清空")

	// 恢复时按低等级额度 drip 一笔,source_ref 为其 order_no
	remaining, err := GetOrderSubscriptionRemaining(502, "ORD-LO2")
	require.NoError(t, err)
	assert.Equal(t, int64(1000), remaining, "恢复时应按低等级额度发放一期积分")
}

// T2：退当前生效(队首)块——清本单积分余量、块置 void、恢复下一个 frozen 块为新当前身份。
func TestRefundOrderSubscription_RefundActiveRestoresFrozen(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 600, Username: "rfa", Password: "x", AccessToken: "tok600", AffCode: "aff600", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	// 当前生效高等级块(发了 2000 积分,剩 1500)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 600, PackageLevel: 2, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 2000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(20 * 24 * time.Hour),
		OrderNo: "ORD-HIR", QueueSeq: 2,
	}).Error)
	hiExp := now.Add(20 * 24 * time.Hour)
	require.NoError(t, AddSubscriptionQuotaPerOrder(600, []SubscriptionQuotaGrant{{Quota: 2000, OrderNo: "ORD-HIR", ExpiresAt: &hiExp}}))
	// 模拟已花 500(直接改账本行剩余,避开 DecreaseUserQuota 的 NOW() 方言):剩 1500
	require.NoError(t, DB.Model(&UserTimedQuota{}).
		Where("user_id = ? AND source_ref = ?", 600, "ORD-HIR").
		Update("remaining", 1500).Error)

	// 冻结排队的低等级块(还剩 2 期未 drip)
	frozenAt := now.Add(-time.Hour)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 600, PackageLevel: 1, Status: SubscriptionStatusFrozen, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-30 * 24 * time.Hour), CurrentPeriodEnd: now.Add(-time.Hour),
		OrderNo: "ORD-LOR", QueueSeq: 1, FrozenAt: &frozenAt,
	}).Error)

	var refunded int64
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		r, err := RefundOrderSubscriptionTx(tx, 600, "ORD-HIR", time.Now())
		refunded = r
		return err
	}))
	assert.Equal(t, int64(1500), refunded, "退款额=本单剩余余量(已花的500不倒扣)")

	// 被退块 void
	var hi Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-HIR").First(&hi).Error)
	assert.Equal(t, SubscriptionStatusVoid, hi.Status)

	// 低等级块被恢复为当前身份
	var lo Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-LOR").First(&lo).Error)
	assert.Equal(t, SubscriptionStatusActive, lo.Status, "退队首后下一个 frozen 块应恢复为当前身份")
	assert.Equal(t, 2, lo.PeriodsUsed, "恢复时 drip 一期")

	// 本单积分已清零、低等级恢复发了一期
	hiRemain, _ := GetOrderSubscriptionRemaining(600, "ORD-HIR")
	assert.Equal(t, int64(0), hiRemain, "被退订单积分余量清零")
	loRemain, _ := GetOrderSubscriptionRemaining(600, "ORD-LOR")
	assert.Equal(t, int64(1000), loRemain, "恢复块按低等级额度发一期")
}

// T2：退队尾 frozen 块——只清本单积分、块置 void、不影响当前生效身份;剩余 frozen 块队列序前移。
func TestRefundOrderSubscription_RefundFrozenKeepsActive(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 601, Username: "rff", Password: "x", AccessToken: "tok601", AffCode: "aff601", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	require.NoError(t, DB.Create(&Subscription{
		UserId: 601, PackageLevel: 2, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 2000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(20 * 24 * time.Hour),
		OrderNo: "ORD-ACT", QueueSeq: 1,
	}).Error)
	// 两个 frozen 块,队列序 2、3
	fz := now.Add(-time.Hour)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 601, PackageLevel: 1, Status: SubscriptionStatusFrozen, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 0,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(30 * 24 * time.Hour),
		OrderNo: "ORD-FZ2", QueueSeq: 2, FrozenAt: &fz,
	}).Error)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 601, PackageLevel: 1, Status: SubscriptionStatusFrozen, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 0,
		CurrentPeriodStart: now, CurrentPeriodEnd: now.Add(30 * 24 * time.Hour),
		OrderNo: "ORD-FZ3", QueueSeq: 3, FrozenAt: &fz,
	}).Error)

	// 退中间的 FZ2
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		_, err := RefundOrderSubscriptionTx(tx, 601, "ORD-FZ2", time.Now())
		return err
	}))

	// 当前 active 块不受影响
	var act Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-ACT").First(&act).Error)
	assert.Equal(t, SubscriptionStatusActive, act.Status, "退 frozen 块不应动当前生效块")

	var fz2 Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-FZ2").First(&fz2).Error)
	assert.Equal(t, SubscriptionStatusVoid, fz2.Status)

	// 剩余 frozen 块(FZ3)队列序前移到 1
	var fz3 Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-FZ3").First(&fz3).Error)
	assert.Equal(t, SubscriptionStatusFrozen, fz3.Status, "其余 frozen 块仍冻结")
	assert.Equal(t, 1, fz3.QueueSeq, "被退块之后的 frozen 块队列序应前移补位")
}

// 场景4(行为2/4)：升级冻结低等级块——已 drip 的本期积分不动(按原到期日自然失效),
// 块停时钟(状态 frozen + 记录 frozen_at),未 drip 的整月留待恢复时从恢复时刻重排。
func TestFreezeKeepsDrippedQuotaAndStopsClock(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 510, Username: "fzk", Password: "x", AccessToken: "tok510", AffCode: "aff510", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	// 低等级块:3 期套餐,已 drip 1 期(发了 1000 积分),本期还没到期
	loExp := now.Add(20 * 24 * time.Hour)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 510, PackageLevel: 1, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-10 * 24 * time.Hour), CurrentPeriodEnd: loExp,
		OrderNo: "ORD-FK", QueueSeq: 1,
	}).Error)
	require.NoError(t, AddSubscriptionQuotaPerOrder(510, []SubscriptionQuotaGrant{{Quota: 1000, OrderNo: "ORD-FK", ExpiresAt: &loExp}}))

	// 升级:更高等级(2)插队,冻结所有 level<2 的 active 块
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return FreezeActiveSubscriptionsBelowTx(tx, 510, 2, now)
	}))

	var lo Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-FK").First(&lo).Error)
	assert.Equal(t, SubscriptionStatusFrozen, lo.Status, "低等级块应被冻结(停时钟)")
	require.NotNil(t, lo.FrozenAt, "冻结时刻应被记录")
	assert.Equal(t, 1, lo.PeriodsUsed, "已 drip 期数不变(未 drip 的整月仍留在 periods_total 里待恢复)")

	// 已 drip 的本期积分不被冻结动到——仍是 1000,按原到期日存活
	remain, err := GetOrderSubscriptionRemaining(510, "ORD-FK")
	require.NoError(t, err)
	assert.Equal(t, int64(1000), remain, "已发放的本期积分冻结时不清退,按原到期日自然失效")
}

// 场景6：多月套餐(年/季卡)每月续期发放——period_days=30、periods_total>1,
// 每跑一次续期 drip 一期、periods_used+1,直到耗尽过期。
func TestMultiPeriodPackageRenewsMonthly(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 520, Username: "mpk", Password: "x", AccessToken: "tok520", AffCode: "aff520", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	// 季卡:3 期,已发首期(periods_used=1),本期已到期等待续期
	require.NoError(t, DB.Create(&Subscription{
		UserId: 520, PackageLevel: 1, Status: SubscriptionStatusActive, BillingCycle: "quarterly",
		QuotaPerPeriod: 1500, PeriodDays: 30, PeriodsTotal: 3, PeriodsUsed: 1,
		CurrentPeriodStart: now.Add(-30 * 24 * time.Hour), CurrentPeriodEnd: now.Add(-time.Hour),
		OrderNo: "ORD-Q", QueueSeq: 1,
	}).Error)

	// 第 2 期续期
	require.NoError(t, ProcessUserSubscriptionRenewal(520))
	var s Subscription
	require.NoError(t, DB.Where("order_no = ?", "ORD-Q").First(&s).Error)
	assert.Equal(t, SubscriptionStatusActive, s.Status, "未耗尽应保持生效")
	assert.Equal(t, 2, s.PeriodsUsed, "续期一次 periods_used=2")
	assert.WithinDuration(t, SubscriptionPeriodEndDays(time.Now(), 30), s.CurrentPeriodEnd, time.Minute, "新到期日从续期时刻 +30 天")
	remain, _ := GetOrderSubscriptionRemaining(520, "ORD-Q")
	assert.Equal(t, int64(1500), remain, "续期 drip 一期积分")

	// 把本期再拨到过去，跑第 3 期(最后一期)
	require.NoError(t, DB.Model(&Subscription{}).Where("order_no = ?", "ORD-Q").
		Update("current_period_end", now.Add(-time.Hour)).Error)
	require.NoError(t, ProcessUserSubscriptionRenewal(520))
	require.NoError(t, DB.Where("order_no = ?", "ORD-Q").First(&s).Error)
	assert.Equal(t, 3, s.PeriodsUsed, "第 3 期续期后 periods_used=3")
	assert.Equal(t, SubscriptionStatusActive, s.Status, "刚发完最后一期仍生效到本期结束")

	// 第 4 次续期：期数耗尽 → 过期，不再发积分
	require.NoError(t, DB.Model(&Subscription{}).Where("order_no = ?", "ORD-Q").
		Update("current_period_end", now.Add(-time.Hour)).Error)
	require.NoError(t, ProcessUserSubscriptionRenewal(520))
	require.NoError(t, DB.Where("order_no = ?", "ORD-Q").First(&s).Error)
	assert.Equal(t, SubscriptionStatusExpired, s.Status, "期数耗尽应过期退场")
	assert.Equal(t, 3, s.PeriodsUsed, "耗尽后不再 drip")
}

// 场景9：退款幂等——同一订单第二次退款应被拒绝(MarkOrderRefunded 的 status='paid' 守卫),
// 不会二次清账。这里走 refundOrderCore 的真实入口验证整链幂等。
func TestRefundOrderIdempotent(t *testing.T) {
	setupQueueModelTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 530, Username: "idem", Password: "x", AccessToken: "tok530", AffCode: "aff530", AccountType: AccountTypePersonal}).Error)

	now := time.Now()
	exp := now.Add(20 * 24 * time.Hour)
	require.NoError(t, DB.Create(&Order{
		OrderNo: "ORD-IDEM", UserId: 530, Quota: 1000,
		Amount: 1000, PackageId: 1, Status: OrderStatusPaid, BillingCycle: "monthly",
	}).Error)
	require.NoError(t, DB.Create(&Subscription{
		UserId: 530, PackageLevel: 1, Status: SubscriptionStatusActive, BillingCycle: "monthly",
		QuotaPerPeriod: 1000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: now, CurrentPeriodEnd: exp, OrderNo: "ORD-IDEM", QueueSeq: 1,
	}).Error)
	require.NoError(t, AddSubscriptionQuotaPerOrder(530, []SubscriptionQuotaGrant{{Quota: 1000, OrderNo: "ORD-IDEM", ExpiresAt: &exp}}))

	// 第一次：成功翻转 paid → refunded
	affected, err := MarkOrderRefunded("ORD-IDEM")
	require.NoError(t, err)
	assert.Equal(t, int64(1), affected, "首次退款应命中 paid 订单")

	// 模拟首次退款已回收订阅积分
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		_, e := RefundOrderSubscriptionTx(tx, 530, "ORD-IDEM", time.Now())
		return e
	}))
	remain, _ := GetOrderSubscriptionRemaining(530, "ORD-IDEM")
	assert.Equal(t, int64(0), remain, "首次退款后本单余量清零")

	// 第二次：守卫拦截，affected=0，调用方据此拒绝，不会再次进入清账
	affected2, err := MarkOrderRefunded("ORD-IDEM")
	require.NoError(t, err)
	assert.Equal(t, int64(0), affected2, "二次退款应被 status 守卫拒绝(已是 refunded)")
}

