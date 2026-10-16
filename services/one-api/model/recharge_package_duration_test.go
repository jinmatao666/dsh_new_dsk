package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupRechargeDurationTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&RechargePackage{}, &MemberIdentity{}))
	DB = db
}

func TestDurationDays(t *testing.T) {
	cases := []struct {
		unit  string
		value int
		want  int
	}{
		{"day", 7, 7},
		{"month", 1, 30},
		{"month", 3, 90},
		{"quarter", 1, 90},
		{"quarter", 2, 180},
		{"year", 1, 365},
		{"", 1, 30},      // 缺省单位按月
		{"month", 0, 30}, // 缺省数值按 1
		{"day", -5, 1},   // 负数值兜底为 1
	}
	for _, c := range cases {
		p := &RechargePackage{DurationUnit: c.unit, DurationValue: c.value}
		assert.Equalf(t, c.want, p.DurationDays(), "unit=%s value=%d", c.unit, c.value)
	}
}

func TestPointCycleDays(t *testing.T) {
	cases := []struct {
		cycle string
		want  int
	}{
		{"once", 0},
		{"", 0}, // 缺省视为一次性
		{"month", 30},
		{"quarter", 90},
		{"year", 365},
		{"day", 1},
	}
	for _, c := range cases {
		p := &RechargePackage{PointCycle: c.cycle}
		assert.Equalf(t, c.want, p.PointCycleDays(), "cycle=%s", c.cycle)
	}
}

func TestEffectiveLevel(t *testing.T) {
	setupRechargeDurationTestDB(t)

	identity := &MemberIdentity{Name: "Pro", PackageId: 1, PackageLevel: 5, Enabled: true}
	assert.NoError(t, DB.Create(identity).Error)

	// 关联会员身份时, 等级取身份的 package_level
	withIdentity := &RechargePackage{Level: 2, IdentityId: identity.Id}
	assert.Equal(t, 5, withIdentity.EffectiveLevel())

	// 未关联身份时, 回退到 Level 列
	noIdentity := &RechargePackage{Level: 2, IdentityId: 0}
	assert.Equal(t, 2, noIdentity.EffectiveLevel())

	// 关联了不存在的身份 ID 时, 回退到 Level 列
	badIdentity := &RechargePackage{Level: 3, IdentityId: 99999}
	assert.Equal(t, 3, badIdentity.EffectiveLevel())
}

func TestEffectivePrice(t *testing.T) {
	cases := []struct {
		name string
		pkg  RechargePackage
		want int
	}{
		{
			name: "price_authoritative_over_legacy_monthly",
			pkg: RechargePackage{
				DurationUnit: "month", Price: 5000, MonthlyPrice: 4900, MonthlyPriceSale: 3900,
			},
			want: 5000,
		},
		{
			name: "legacy_monthly_sale_when_price_zero",
			pkg: RechargePackage{
				DurationUnit: "month", Price: 0, MonthlyPrice: 4900, MonthlyPriceSale: 3900,
			},
			want: 3900,
		},
		{
			name: "legacy_monthly_price_when_price_zero",
			pkg: RechargePackage{
				DurationUnit: "month", Price: 0, MonthlyPrice: 4900,
			},
			want: 4900,
		},
		{
			name: "price_authoritative_over_legacy_yearly",
			pkg: RechargePackage{
				DurationUnit: "year", Price: 120000, YearlyPrice: 108000, YearlyPriceSale: 94800,
			},
			want: 120000,
		},
		{
			name: "legacy_yearly_when_price_zero",
			pkg: RechargePackage{
				DurationUnit: "year", Price: 0, YearlyPrice: 108000,
			},
			want: 108000,
		},
		{
			name: "base_price",
			pkg:  RechargePackage{DurationUnit: "month", Price: 5000},
			want: 5000,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.pkg.EffectivePrice())
		})
	}
}

func TestSubscriptionPeriodEndDays(t *testing.T) {
	base := time.Date(2026, 6, 11, 15, 30, 0, 0, time.UTC)

	// 对齐到当天 0 点 + days 天
	end30 := SubscriptionPeriodEndDays(base, 30)
	assert.Equal(t, time.Date(2026, 7, 11, 0, 0, 0, 0, time.UTC), end30)

	end90 := SubscriptionPeriodEndDays(base, 90)
	assert.Equal(t, time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC), end90)

	// days<=0 回退 30 天, 与默认 SubscriptionPeriodEnd 一致
	assert.Equal(t, SubscriptionPeriodEnd(base), SubscriptionPeriodEndDays(base, 0))
}
