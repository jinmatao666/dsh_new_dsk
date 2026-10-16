package controller

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/model"
)

// 这些测试只在 :memory: SQLite 内运行,完全隔离于本地/生产数据库.
// model.DB / model.LOG_DB 在 setup 时被替换,测试结束随进程退出销毁.

func setupPaymentTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.Organization{},
		&model.Subscription{},
		&model.RechargePackage{},
		&model.RechargeRecord{},
		&model.Order{},
		&model.UserTimedQuota{},
		&model.OrgTimedQuota{},
		&model.Log{},
	))
	model.DB = db
	model.LOG_DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false
}

func seedPersonalUser(t *testing.T, id int) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.User{
		Id:          id,
		Username:    "u" + time.Now().Format("150405.000000000"),
		Password:    "x",
		AccountType: model.AccountTypePersonal,
	}).Error)
}

func seedEnterpriseOrgAndUser(t *testing.T, orgId, userId int) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.Organization{
		Id:            orgId,
		Name:          "Org" + time.Now().String(),
		Code:          "code-" + time.Now().Format("150405.000000000"),
		Status:        model.OrgStatusEnabled,
		Group:         "default",
		LoginUsername: "biz-" + time.Now().Format("150405.000000000"),
	}).Error)
	require.NoError(t, model.DB.Create(&model.User{
		Id:          userId,
		Username:    "biz-user-" + time.Now().Format("150405.000000000"),
		Password:    "x",
		AccountType: model.AccountTypeEnterprise,
		OrgId:       orgId,
	}).Error)
}

func seedRechargePackage(t *testing.T, id int, point float64, level int) *model.RechargePackage {
	t.Helper()
	pkg := &model.RechargePackage{
		Id:           id,
		Name:         "测试套餐",
		Price:        100,
		Point:        point,
		Level:        level,
		MonthlyPrice: 100,
		Enabled:      true,
		Scope:        model.RechargeScopePersonal,
	}
	require.NoError(t, model.DB.Create(pkg).Error)
	return pkg
}

func makePaidOrder(orderNo string, userId, pkgId int, quota int64) Order {
	return Order{
		OrderNo:      orderNo,
		UserID:       userId,
		Username:     "u",
		PackageID:    pkgId,
		PackageName:  "测试套餐",
		Amount:       100,
		Quota:        quota,
		BillingCycle: "monthly",
		PayType:      "wechat",
		Status:       "paid",
	}
}

// 时长(季) + 发放周期(每月) 的订阅:应建出 PeriodsTotal=3、PeriodDays=30 的订阅,
// 且等级取自关联会员身份的 package_level,而非套餐自身的 Level 列。
func TestCreateSubscription_DurationAndCycle(t *testing.T) {
	setupPaymentTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.MemberIdentity{}))
	seedPersonalUser(t, 200)

	identity := &model.MemberIdentity{Name: "尊享", PackageId: 1, PackageLevel: 7, Enabled: true}
	require.NoError(t, model.DB.Create(identity).Error)

	pkg := &model.RechargePackage{
		Id:            1,
		Name:          "季度套餐",
		Price:         29900,
		Point:         100,
		Level:         1, // 应被会员身份的等级覆盖
		DurationUnit:  "quarter",
		DurationValue: 1,
		PointCycle:    "month",
		IdentityId:    identity.Id,
		Enabled:       true,
		Scope:         model.RechargeScopePersonal,
	}
	require.NoError(t, model.DB.Create(pkg).Error)

	order := makePaidOrder("P-DUR-1", 200, pkg.Id, pkg.CalcQuota())
	require.NoError(t, createSubscriptionAfterPayment(order))

	var sub model.Subscription
	require.NoError(t, model.DB.Where("user_id = ?", 200).First(&sub).Error)
	assert.Equal(t, 3, sub.PeriodsTotal, "季度/每月 = 3 期")
	assert.Equal(t, 30, sub.PeriodDays, "每期 30 天")
	assert.Equal(t, 7, sub.PackageLevel, "等级应取自会员身份")
}

// 一次性发放(point_cycle=once):整个时长 1 期,首期发全部积分。
func TestCreateSubscription_OnceCycle(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 201)

	pkg := &model.RechargePackage{
		Id:            2,
		Name:          "年度一次性",
		Price:         99900,
		Point:         500,
		Level:         3,
		DurationUnit:  "year",
		DurationValue: 1,
		PointCycle:    "once",
		Enabled:       true,
		Scope:         model.RechargeScopePersonal,
	}
	require.NoError(t, model.DB.Create(pkg).Error)

	order := makePaidOrder("P-ONCE-1", 201, pkg.Id, pkg.CalcQuota())
	require.NoError(t, createSubscriptionAfterPayment(order))

	var sub model.Subscription
	require.NoError(t, model.DB.Where("user_id = ?", 201).First(&sub).Error)
	assert.Equal(t, 1, sub.PeriodsTotal, "一次性发放 = 1 期")
	assert.Equal(t, 365, sub.PeriodDays, "一次性时每期天数=整个时长")
	assert.Equal(t, 3, sub.PackageLevel, "未关联身份时回退套餐 Level")
}

// seedActiveSubscription 造一条 active 订阅 + 对应已支付订单 + 订阅积分账本,
// 模拟用户已持有低等级套餐的状态.amount 为该订单实付额(分).
func seedActiveSubscription(t *testing.T, userId, pkgId, level int, cycle string, amount int, quota int64, periodEnd time.Time) *model.Subscription {
	t.Helper()
	orderNo := "SEED-" + time.Now().Format("150405.000000000")
	require.NoError(t, model.DB.Table("orders").Create(&Order{
		OrderNo:      orderNo,
		UserID:       userId,
		Username:     "u",
		PackageID:    pkgId,
		PackageName:  "低套餐",
		Amount:       amount,
		Quota:        quota,
		BillingCycle: cycle,
		PayType:      "wechat",
		Status:       "paid",
	}).Error)

	sub := &model.Subscription{
		UserId:             userId,
		PackageId:          pkgId,
		PackageLevel:       level,
		BillingCycle:       cycle,
		Status:             "active",
		QuotaPerPeriod:     quota,
		PeriodsTotal:       1,
		PeriodsUsed:        1,
		CurrentPeriodStart: time.Now(),
		CurrentPeriodEnd:   periodEnd,
		SubscriptionEnd:    periodEnd,
		OrderNo:            orderNo,
	}
	require.NoError(t, model.DB.Create(sub).Error)
	// 发放低等级订阅积分账本,使后续"清零"可被断言
	require.NoError(t, model.IncreaseUserSubscriptionQuota(userId, quota, orderNo, &periodEnd))
	return sub
}

//  1. 正常首购:subscription / user_timed_quotas / recharge_records 各落 1 条,
//     users.quota 镜像列被正确写入.
func TestCreateSubscription_Success(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 100)
	pkg := seedRechargePackage(t, 1, 1.0, 1)
	order := makePaidOrder("P-OK-1", 100, pkg.Id, pkg.CalcQuota())

	require.NoError(t, createSubscriptionAfterPayment(order))

	var subs []model.Subscription
	require.NoError(t, model.DB.Where("user_id = ?", 100).Find(&subs).Error)
	assert.Len(t, subs, 1, "应只创建 1 条 subscription")
	assert.Equal(t, "P-OK-1", subs[0].OrderNo)

	var ledgers []model.UserTimedQuota
	require.NoError(t, model.DB.Where("user_id = ?", 100).Find(&ledgers).Error)
	assert.Len(t, ledgers, 1, "应只发 1 笔订阅积分")
	assert.EqualValues(t, pkg.CalcQuota(), ledgers[0].Remaining)

	var rechargeCount int64
	require.NoError(t, model.DB.Model(&model.RechargeRecord{}).
		Where("order_no = ?", "P-OK-1").Count(&rechargeCount).Error)
	assert.EqualValues(t, 1, rechargeCount, "应只写 1 条充值记录")

	u, err := model.GetUserById(100, false)
	require.NoError(t, err)
	assert.EqualValues(t, pkg.CalcQuota(), u.Quota, "users.quota 镜像列应被写入")
	assert.EqualValues(t, pkg.CalcQuota(), u.SubscriptionQuota)
}

//  2. 应用层幂等:同一订单连调两次,第二次直接 return,数据完全不变.
//     这是本次修改的核心目标 — 防止 webhook 与查单赛跑导致双发.
func TestCreateSubscription_Idempotent(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 101)
	pkg := seedRechargePackage(t, 2, 1.0, 1)
	order := makePaidOrder("P-IDEM-1", 101, pkg.Id, pkg.CalcQuota())

	require.NoError(t, createSubscriptionAfterPayment(order))
	require.NoError(t, createSubscriptionAfterPayment(order), "重复调用应静默成功,不报错")

	var subCount, ledgerCount, recordCount int64
	model.DB.Model(&model.Subscription{}).Where("user_id = ?", 101).Count(&subCount)
	model.DB.Model(&model.UserTimedQuota{}).Where("user_id = ?", 101).Count(&ledgerCount)
	model.DB.Model(&model.RechargeRecord{}).Where("order_no = ?", "P-IDEM-1").Count(&recordCount)

	assert.EqualValues(t, 1, subCount, "subscription 不应翻倍")
	assert.EqualValues(t, 1, ledgerCount, "积分账本不应翻倍")
	assert.EqualValues(t, 1, recordCount, "充值记录不应翻倍")

	u, _ := model.GetUserById(101, false)
	assert.EqualValues(t, pkg.CalcQuota(), u.Quota, "users.quota 不应翻倍")
}

// 3. 企业充值幂等:同一订单两次进入 creditOrgRecharge,只发一次额度,只写一条记录.
func TestCreditOrgRecharge_Idempotent(t *testing.T) {
	setupPaymentTestDB(t)
	seedEnterpriseOrgAndUser(t, 9, 200)
	orgId := 9
	order := Order{
		OrderNo:  "ORG-IDEM-1",
		UserID:   200,
		Username: "biz",
		Amount:   100,
		Quota:    500,
		PayType:  "wechat",
		Status:   "paid",
		OrgId:    &orgId,
	}

	require.NoError(t, creditOrgRecharge(order))
	require.NoError(t, creditOrgRecharge(order), "重复调用应静默成功")

	avail, err := model.GetOrgAvailableQuota(orgId)
	require.NoError(t, err)
	assert.EqualValues(t, 500, avail, "企业可用额度不应翻倍")

	var recordCount int64
	model.DB.Model(&model.RechargeRecord{}).Where("order_no = ?", "ORG-IDEM-1").Count(&recordCount)
	assert.EqualValues(t, 1, recordCount, "充值记录不应翻倍")

	var ledgerCount int64
	model.DB.Model(&model.OrgTimedQuota{}).Where("org_id = ?", orgId).Count(&ledgerCount)
	assert.EqualValues(t, 1, ledgerCount, "企业额度账本不应翻倍")
}

//  4. 低买高(队列模型升级):旧订阅 frozen(不再 expired/清零)、新高等级块 active 插队首、
//     积分=旧块保留 + 高等级整期(钱包叠加,非覆盖)、新块到期日按自身周期(不再对齐旧块).
func TestUpgrade_FreezesLowAndStacksQuota(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 300)
	// 低等级 Lv1 月付,剩余到期日在 20 天后,seed 发放 1000 订阅积分
	lowEnd := time.Now().AddDate(0, 0, 20)
	low := seedActiveSubscription(t, 300, 1, 1, "monthly", 3000, 1000, lowEnd)

	// 高等级 Lv2 套餐
	high := seedRechargePackage(t, 2, 5.0, 2)
	order := makePaidOrder("UP-1", 300, high.Id, high.CalcQuota())

	require.NoError(t, createSubscriptionAfterPayment(order))

	// 旧低等级块应被冻结(保留时长,停时钟),不再 expired
	var oldSub model.Subscription
	require.NoError(t, model.DB.Where("id = ?", low.Id).First(&oldSub).Error)
	assert.Equal(t, model.SubscriptionStatusFrozen, oldSub.Status, "旧低等级块应被冻结")
	require.NotNil(t, oldSub.FrozenAt)

	// 新高等级块为唯一 active
	var actives []model.Subscription
	require.NoError(t, model.DB.Where("user_id = ? AND status = ?", 300, "active").Find(&actives).Error)
	require.Len(t, actives, 1, "应只剩一条 active(新高等级块)")
	assert.Equal(t, "UP-1", actives[0].OrderNo)
	assert.Equal(t, 2, actives[0].PackageLevel)

	// 订阅积分=旧块保留(1000)+ 高等级整期(钱包叠加,不再覆盖清零)
	u, _ := model.GetUserById(300, false)
	assert.EqualValues(t, 1000+high.CalcQuota(), u.SubscriptionQuota, "订阅积分应为旧块保留+高等级整期(叠加)")
	assert.EqualValues(t, 1000+high.CalcQuota(), u.Quota, "镜像列应同步")

	// 新块到期日按自身发放周期推算(队列模型各块各自记时,不再对齐旧块)
	var newSub model.Subscription
	require.NoError(t, model.DB.Where("order_no = ?", "UP-1").First(&newSub).Error)
	assert.WithinDuration(t, model.SubscriptionPeriodEndDays(time.Now(), newSub.PeriodDays), newSub.CurrentPeriodEnd, time.Minute)
}

// 4b. 同级再买(队列模型):新块排队 frozen、本期积分不立即发(periods_used=0)、当前 active 块不受影响。
//
//	对应规则文档行为 1/5:同级购买=时长顺延累加,积分按周期 drip,不立即发、不覆盖。
func TestSameLevelPurchase_QueuesFrozenNoImmediateQuota(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 330)
	// 当前 Lv1 在手,发了 1000 订阅积分
	low := seedActiveSubscription(t, 330, 1, 1, "monthly", 3000, 1000, time.Now().AddDate(0, 0, 20))
	_ = low
	uBefore, _ := model.GetUserById(330, false)

	// 再买同等级 Lv1 套餐
	samePkg := seedRechargePackage(t, 5, 1.0, 1)
	order := makePaidOrder("SAME-1", 330, samePkg.Id, samePkg.CalcQuota())
	require.NoError(t, model.DB.Table("orders").Create(&order).Error)
	require.NoError(t, createSubscriptionAfterPayment(order))

	// 新块应为 frozen、periods_used=0(尚未 drip 任何一期)
	var newSub model.Subscription
	require.NoError(t, model.DB.Where("order_no = ?", "SAME-1").First(&newSub).Error)
	assert.Equal(t, model.SubscriptionStatusFrozen, newSub.Status, "同级新块应排队冻结")
	assert.Equal(t, 0, newSub.PeriodsUsed, "排队块本期不 drip,已发期数=0")

	// 原 active 块不受影响
	var oldSub model.Subscription
	require.NoError(t, model.DB.Where("id = ?", low.Id).First(&oldSub).Error)
	assert.Equal(t, model.SubscriptionStatusActive, oldSub.Status, "原 active 块同级购买后仍生效")

	// 用户订阅积分不变(同级本期不立即发)
	uAfter, _ := model.GetUserById(330, false)
	assert.EqualValues(t, uBefore.SubscriptionQuota, uAfter.SubscriptionQuota, "同级购买本期不立即发积分")
}

// 9. 不变量:升级只动订阅积分的发放(叠加),限时积分(topup)与永久积分(admin)分文不动.
//
//	这是关键正确性边界 — 队列模型发放必须严格锁在 source='subscription'.
func TestUpgrade_DoesNotTouchOtherQuota(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 320)

	// 先发两笔非订阅积分:一笔充值(限时)、一笔管理员(永久)
	require.NoError(t, model.AddUserTimedQuota(320, 7000, model.TimedQuotaSourceTopup, "topup-ref", nil))
	require.NoError(t, model.AddUserTimedQuota(320, 5000, model.TimedQuotaSourceAdmin, "admin-ref", nil))

	// 低等级在手(剩 15 天,seed 发 1000 订阅积分),再升级到高等级
	low := seedActiveSubscription(t, 320, 1, 1, "monthly", 3000, 1000, time.Now().AddDate(0, 0, 15))
	_ = low
	high := seedRechargePackage(t, 2, 5.0, 2)
	require.NoError(t, createSubscriptionAfterPayment(makePaidOrder("UP-KEEP", 320, high.Id, high.CalcQuota())))

	// 限时积分(topup)与永久积分(admin)账本应原封不动
	var topupRemain, adminRemain int64
	model.DB.Model(&model.UserTimedQuota{}).
		Where("user_id = ? AND source = ?", 320, model.TimedQuotaSourceTopup).
		Select("COALESCE(SUM(remaining),0)").Scan(&topupRemain)
	model.DB.Model(&model.UserTimedQuota{}).
		Where("user_id = ? AND source = ?", 320, model.TimedQuotaSourceAdmin).
		Select("COALESCE(SUM(remaining),0)").Scan(&adminRemain)
	assert.EqualValues(t, 7000, topupRemain, "充值(限时)积分不应被升级触碰")
	assert.EqualValues(t, 5000, adminRemain, "管理员(永久)积分不应被升级触碰")

	// 订阅积分=旧块保留(1000)+高等级整期(叠加);timed_quota_total 仍含 topup+admin
	u, _ := model.GetUserById(320, false)
	assert.EqualValues(t, 1000+high.CalcQuota(), u.SubscriptionQuota, "订阅积分应为旧块保留+高等级整期(叠加)")
	assert.EqualValues(t, 12000, u.TimedQuotaTotal, "限时积分总和应保持 7000+5000")
	assert.EqualValues(t, 1000+high.CalcQuota()+12000, u.Quota, "总额=订阅(叠加)+限时积分")
}

// 8. 迁移脚本:多条 active 订阅收敛成最高级一条,到期日取最晚,积分余额不变.
func TestMergeMultiActiveSubscriptions(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 304)

	end1 := time.Now().AddDate(0, 0, 10)
	end2 := time.Now().AddDate(0, 0, 25)
	// Lv1(到期早)+ Lv2(到期晚)
	require.NoError(t, model.DB.Create(&model.Subscription{
		UserId: 304, PackageId: 1, PackageLevel: 1, BillingCycle: "monthly",
		Status: "active", QuotaPerPeriod: 1000, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodEnd: end1, SubscriptionEnd: end1, OrderNo: "M-1",
	}).Error)
	require.NoError(t, model.DB.Create(&model.Subscription{
		UserId: 304, PackageId: 2, PackageLevel: 2, BillingCycle: "monthly",
		Status: "active", QuotaPerPeriod: 5000, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodEnd: end2, SubscriptionEnd: end2, OrderNo: "M-2",
	}).Error)

	require.NoError(t, model.RunMergeMultiActiveSubscriptionsForTest())

	var actives []model.Subscription
	require.NoError(t, model.DB.Where("user_id = ? AND status = ?", 304, "active").Find(&actives).Error)
	require.Len(t, actives, 1, "应只剩一条 active")
	assert.Equal(t, 2, actives[0].PackageLevel, "应保留最高等级")
	assert.False(t, actives[0].CurrentPeriodEnd.Before(end2), "到期日应取最晚")
}

// 9. 个人订单全额退积分:充值后退,订阅置 expired,用户积分扣回,剩余 >= 0,订单状态 refunded.
func TestRefundOrder_PersonalFull(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 400)
	pkg := seedRechargePackage(t, 1, 1.0, 1)
	order := makePaidOrder("RF-P-1", 400, pkg.Id, pkg.CalcQuota())
	require.NoError(t, model.DB.Table("orders").Create(&order).Error)
	require.NoError(t, createSubscriptionAfterPayment(order))

	// 重新读订单(createSubscriptionAfterPayment 回填了 subscription_id)
	var dbOrder Order
	require.NoError(t, model.DB.Table("orders").Where("order_no = ?", "RF-P-1").First(&dbOrder).Error)

	refunded, err := refundOrderCore(dbOrder, 1, "admin")
	require.NoError(t, err)
	assert.EqualValues(t, pkg.CalcQuota(), refunded, "应全额退回订单积分")

	// 订阅应被撤销
	var activeCount int64
	model.DB.Model(&model.Subscription{}).Where("user_id = ? AND status = ?", 400, "active").Count(&activeCount)
	assert.EqualValues(t, 0, activeCount, "退积分应撤销 active 订阅")

	// 用户剩余积分归零且不为负
	avail, err := model.GetUserQuota(400)
	require.NoError(t, err)
	assert.EqualValues(t, 0, avail, "退积分后用户余额应为 0")
	assert.GreaterOrEqual(t, avail, int64(0), "余额不能为负")

	// 订单状态翻转
	var st string
	model.DB.Table("orders").Where("order_no = ?", "RF-P-1").Select("status").Scan(&st)
	assert.Equal(t, "refunded", st)
}

// 10. 个人订单部分消费后退:实退 = min(订单积分, 当前可用),剩余 >= 0.
func TestRefundOrder_PersonalPartialConsumed(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 401)
	pkg := seedRechargePackage(t, 1, 1.0, 1)
	full := pkg.CalcQuota()
	order := makePaidOrder("RF-P-2", 401, pkg.Id, full)
	require.NoError(t, model.DB.Table("orders").Create(&order).Error)
	require.NoError(t, createSubscriptionAfterPayment(order))

	// 先消费掉一部分(模拟用户已用)
	consume := full / 4
	require.NoError(t, model.DecreaseUserQuota(401, consume))
	availBefore, _ := model.GetUserQuota(401)
	require.EqualValues(t, full-consume, availBefore)

	var dbOrder Order
	require.NoError(t, model.DB.Table("orders").Where("order_no = ?", "RF-P-2").First(&dbOrder).Error)

	refunded, err := refundOrderCore(dbOrder, 1, "admin")
	require.NoError(t, err)
	assert.EqualValues(t, availBefore, refunded, "实退应为 min(订单积分, 当前可用)")

	avail, err := model.GetUserQuota(401)
	require.NoError(t, err)
	assert.EqualValues(t, 0, avail, "退积分后余额应为 0")
	assert.GreaterOrEqual(t, avail, int64(0), "余额不能为负")
}

// 11. 企业订单退积分:充值后退,企业可用额度归零,剩余 >= 0.
func TestRefundOrder_Enterprise(t *testing.T) {
	setupPaymentTestDB(t)
	seedEnterpriseOrgAndUser(t, 9, 402)
	orgId := 9
	order := Order{
		OrderNo:  "RF-ORG-1",
		UserID:   402,
		Username: "biz",
		Amount:   100,
		Quota:    500,
		PayType:  "wechat",
		Status:   "paid",
		OrgId:    &orgId,
	}
	require.NoError(t, model.DB.Table("orders").Create(&order).Error)
	require.NoError(t, creditOrgRecharge(order))

	availBefore, _ := model.GetOrgAvailableQuota(orgId)
	require.EqualValues(t, 500, availBefore)

	refunded, err := refundOrderCore(order, 1, "admin")
	require.NoError(t, err)
	assert.EqualValues(t, 500, refunded, "应全额退回企业积分")

	avail, err := model.GetOrgAvailableQuota(orgId)
	require.NoError(t, err)
	assert.EqualValues(t, 0, avail, "退积分后企业可用额度应为 0")
	assert.GreaterOrEqual(t, avail, int64(0), "企业余额不能为负")
}

// 12. 幂等:同一订单退两次,第二次被拒,积分不再变动,状态保持 refunded.
func TestRefundOrder_Idempotent(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 403)
	pkg := seedRechargePackage(t, 1, 1.0, 1)
	order := makePaidOrder("RF-IDEM-1", 403, pkg.Id, pkg.CalcQuota())
	require.NoError(t, model.DB.Table("orders").Create(&order).Error)
	require.NoError(t, createSubscriptionAfterPayment(order))

	var dbOrder Order
	require.NoError(t, model.DB.Table("orders").Where("order_no = ?", "RF-IDEM-1").First(&dbOrder).Error)
	_, err := refundOrderCore(dbOrder, 1, "admin")
	require.NoError(t, err)

	avail1, _ := model.GetUserQuota(403)

	// 第二次:订单已是 refunded,核心函数 status 检查直接拒绝
	dbOrder.Status = "refunded"
	_, err = refundOrderCore(dbOrder, 1, "admin")
	assert.Error(t, err, "重复退款应被拒绝")

	avail2, _ := model.GetUserQuota(403)
	assert.EqualValues(t, avail1, avail2, "重复退款不应再次扣减积分")

	var recordCount int64
	model.DB.Model(&model.RechargeRecord{}).
		Where("order_no = ? AND quota < 0", "RF-IDEM-1").Count(&recordCount)
	assert.EqualValues(t, 1, recordCount, "应只写一条退款记录")
}

// 13. 非 paid 订单不可退款.
func TestRefundOrder_NonPaidRejected(t *testing.T) {
	setupPaymentTestDB(t)
	seedPersonalUser(t, 404)
	pkg := seedRechargePackage(t, 1, 1.0, 1)
	order := makePaidOrder("RF-PEND-1", 404, pkg.Id, pkg.CalcQuota())
	order.Status = "pending"
	require.NoError(t, model.DB.Table("orders").Create(&order).Error)

	_, err := refundOrderCore(order, 1, "admin")
	assert.Error(t, err, "pending 订单不可退款")
}
