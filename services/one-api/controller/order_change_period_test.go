package controller

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/model"
)

// 年付→月付：原订阅 periods_total=12/period_days=30，改为月付套餐后
// 应变成 periods_total=1，使续期 cron 不再多发 11 个月。
func TestUpdateSubscriptionForChange_YearlyToMonthly(t *testing.T) {
	setupPaymentTestDB(t)
	require.NoError(t, model.DB.Create(&model.User{Id: 1, Username: "u1", AccountType: model.AccountTypePersonal}).Error)

	periodEnd := time.Now().AddDate(0, 0, 30)
	sub := model.Subscription{
		UserId:             1,
		PackageId:          10,
		PackageLevel:       3,
		BillingCycle:       "yearly",
		Status:             "active",
		QuotaPerPeriod:     1500000,
		PeriodDays:         30,
		PeriodsTotal:       12,
		PeriodsUsed:        1,
		CurrentPeriodStart: time.Now(),
		CurrentPeriodEnd:   periodEnd,
		SubscriptionEnd:    periodEnd.AddDate(0, 0, 30*11),
		OrderNo:            "ORDY",
	}
	require.NoError(t, model.DB.Create(&sub).Error)

	// 目标：月付套餐（时长 1 月、按月发放 => periodsTotal=1）
	monthlyPkg := model.RechargePackage{
		Id: 20, Name: "月基础", Price: 3900, Point: 50, Level: 1,
		PackageType: "subscription", DurationUnit: "month", DurationValue: 1, PointCycle: "month",
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		return updateSubscriptionForChange(tx, "ORDY", &monthlyPkg, monthlyPkg.CalcQuota())
	})
	require.NoError(t, err)

	var got model.Subscription
	require.NoError(t, model.DB.Where("order_no = ?", "ORDY").First(&got).Error)
	assert.Equal(t, 1, got.PeriodsTotal, "月付应只剩 1 期，避免续期多发")
	assert.Equal(t, 30, got.PeriodDays)
	assert.Equal(t, 1, got.PeriodsUsed)
	assert.Equal(t, "monthly", got.BillingCycle)
	assert.Equal(t, 20, got.PackageId)
	assert.Equal(t, monthlyPkg.CalcQuota(), got.QuotaPerPeriod)
	// subscription_end = current_period_end + (1-1)*30 = current_period_end
	assert.WithinDuration(t, got.CurrentPeriodEnd, got.SubscriptionEnd, time.Second)

	// 把当前期推到已到期,触发续期判定(队列模型续期只处理 current_period_end<=now 的块)
	require.NoError(t, model.DB.Model(&model.Subscription{}).Where("order_no = ?", "ORDY").
		Update("current_period_end", time.Now().Add(-time.Hour)).Error)
	err = model.ProcessUserSubscriptionRenewal(1)
	require.NoError(t, err)
	require.NoError(t, model.DB.Where("order_no = ?", "ORDY").First(&got).Error)
	assert.Equal(t, "expired", got.Status, "年费改月费后应在当前期结束时过期，不应继续逐月发放")
	assert.Equal(t, 1, got.PeriodsUsed)
}

// 月付→年付：原订阅 periods_total=1，改为年付套餐后应变成 periods_total=12，
// 使续期 cron 后续按月续期 11 次。
func TestUpdateSubscriptionForChange_MonthlyToYearly(t *testing.T) {
	setupPaymentTestDB(t)

	periodEnd := time.Now().AddDate(0, 0, 30)
	sub := model.Subscription{
		UserId: 1, PackageId: 20, PackageLevel: 1, BillingCycle: "monthly", Status: "active",
		QuotaPerPeriod: 50000, PeriodDays: 30, PeriodsTotal: 1, PeriodsUsed: 1,
		CurrentPeriodStart: time.Now(), CurrentPeriodEnd: periodEnd, SubscriptionEnd: periodEnd,
		OrderNo: "ORDM",
	}
	require.NoError(t, model.DB.Create(&sub).Error)

	yearlyPkg := model.RechargePackage{
		Id: 10, Name: "年专业", Price: 94800, Point: 1500, Level: 3,
		PackageType: "subscription", DurationUnit: "year", DurationValue: 1, PointCycle: "month",
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		return updateSubscriptionForChange(tx, "ORDM", &yearlyPkg, yearlyPkg.CalcQuota())
	})
	require.NoError(t, err)

	var got model.Subscription
	require.NoError(t, model.DB.Where("order_no = ?", "ORDM").First(&got).Error)
	assert.Equal(t, 12, got.PeriodsTotal, "年付应有 12 期，后续按月续期")
	assert.Equal(t, 30, got.PeriodDays)
	assert.Equal(t, "yearly", got.BillingCycle)
	assert.Equal(t, 10, got.PackageId)
	// subscription_end = current_period_end + 11*30 天
	wantEnd := got.CurrentPeriodEnd.AddDate(0, 0, 30*11)
	assert.WithinDuration(t, wantEnd, got.SubscriptionEnd, time.Second)
}

func TestUpdateSubscriptionForChange_RequiresActiveSubscription(t *testing.T) {
	setupPaymentTestDB(t)

	pkg := model.RechargePackage{
		Id: 20, Name: "月基础", Price: 3900, Point: 50, Level: 1,
		PackageType: "subscription", DurationUnit: "month", DurationValue: 1, PointCycle: "month",
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		return updateSubscriptionForChange(tx, "MISSING", &pkg, pkg.CalcQuota())
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "无活跃订阅")
}
