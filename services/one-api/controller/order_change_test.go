package controller

import (
	"testing"

	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestComputeOrderChange 覆盖改单核心计算：
//   - newRemaining = max(qNew - used, 0)，保证 >= 0
//   - delta        = newRemaining - oldRemaining（可正可负）
//   - refund       = max(paidOld - priceNew, 0)，保证 >= 0
func TestComputeOrderChange(t *testing.T) {
	cases := []struct {
		name         string
		qNew         int64
		used         int64
		oldRemaining int64
		paidOld      int
		priceNew     int
		wantNewRem   int64
		wantDelta    int64
		wantRefund   int
	}{
		{
			name: "downgrade_with_refund",
			qNew: 50000000, used: 20000000, oldRemaining: 130000000,
			paidOld: 94800, priceNew: 3900,
			wantNewRem: 30000000, wantDelta: -100000000, wantRefund: 90900,
		},
		{
			name: "used_exceeds_target_clamped_to_zero",
			qNew: 50000000, used: 60000000, oldRemaining: 90000000,
			paidOld: 94800, priceNew: 3900,
			wantNewRem: 0, wantDelta: -90000000, wantRefund: 90900,
		},
		{
			name: "upgrade_no_refund",
			qNew: 150000000, used: 10000000, oldRemaining: 40000000,
			paidOld: 3900, priceNew: 9900,
			wantNewRem: 140000000, wantDelta: 100000000, wantRefund: 0,
		},
		{
			name: "negative_used_treated_as_zero",
			qNew: 50000000, used: -5, oldRemaining: 50000000,
			paidOld: 3900, priceNew: 3900,
			wantNewRem: 50000000, wantDelta: 0, wantRefund: 0,
		},
		{
			name: "equal_price_no_refund",
			qNew: 50000000, used: 0, oldRemaining: 50000000,
			paidOld: 3900, priceNew: 3900,
			wantNewRem: 50000000, wantDelta: 0, wantRefund: 0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeOrderChange(tc.qNew, tc.used, tc.oldRemaining, tc.paidOld, tc.priceNew)
			if got.NewRemaining != tc.wantNewRem {
				t.Errorf("NewRemaining = %d, want %d", got.NewRemaining, tc.wantNewRem)
			}
			if got.DeltaQuota != tc.wantDelta {
				t.Errorf("DeltaQuota = %d, want %d", got.DeltaQuota, tc.wantDelta)
			}
			if got.RefundAmount != tc.wantRefund {
				t.Errorf("RefundAmount = %d, want %d", got.RefundAmount, tc.wantRefund)
			}
		})
	}
}

func TestLoadOrderChangeContextRejectsEnterpriseOrder(t *testing.T) {
	setupPaymentTestDB(t)

	orgId := 1
	require.NoError(t, model.DB.Create(&model.Order{
		OrderNo:   "ORGE",
		UserId:    1,
		Username:  "org",
		PackageId: 10,
		Status:    model.OrderStatusPaid,
		OrgId:     &orgId,
	}).Error)

	_, err := loadOrderChangeContext("ORGE", 20)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "企业订单不支持改单")
}

func TestLoadOrderChangeContextPersonalOrderRejectsEnterprisePackage(t *testing.T) {
	setupPaymentTestDB(t)

	require.NoError(t, model.DB.Create(&model.RechargePackage{
		Id: 10, Name: "个人月付", Enabled: true, Scope: model.RechargeScopePersonal,
		PackageType: "subscription", DurationUnit: "month", DurationValue: 1, PointCycle: "month", Point: 50,
	}).Error)
	require.NoError(t, model.DB.Create(&model.RechargePackage{
		Id: 20, Name: "企业套餐", Enabled: true, Scope: model.RechargeScopeEnterprise,
		PackageType: "subscription", DurationUnit: "month", DurationValue: 1, PointCycle: "month", Point: 500,
	}).Error)
	require.NoError(t, model.DB.Create(&model.Order{
		OrderNo:     "PERS",
		UserId:      1,
		Username:    "u1",
		PackageId:   10,
		PackageName: "个人月付",
		Status:      model.OrderStatusPaid,
		Quota:       50,
		Amount:      3900,
	}).Error)

	_, err := loadOrderChangeContext("PERS", 20)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "个人订单只能改为个人套餐")
}
