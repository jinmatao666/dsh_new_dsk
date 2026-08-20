package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
)

func setupOrgQuotaTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&Organization{},
		&OrgTimedQuota{},
	))
	DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
}

func newOrgForLedgerTest(t *testing.T, id int) {
	t.Helper()
	require.NoError(t, DB.Create(&Organization{
		Id:            id,
		Name:          "Org" + time.Now().String(),
		Code:          "code-" + time.Now().Format("150405.000000000"),
		Status:        OrgStatusEnabled,
		Group:         "default",
		LoginUsername: "u-" + time.Now().Format("150405.000000000"),
	}).Error)
}

func TestAddOrgTimedQuota_UpdatesMirrorAndLedger(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)

	require.NoError(t, AddOrgTimedQuota(1, 1000, OrgTimedQuotaSourceTopup, "order-x", nil))

	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 1000, org.Quota)
	assert.EqualValues(t, 0, org.UsedQuota)

	avail, err := GetOrgAvailableQuota(1)
	require.NoError(t, err)
	assert.EqualValues(t, 1000, avail)
}

func TestDecreaseOrgQuotaByLedger_ConsumesShortestExpiryFirst(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)

	short := 7 * 24 * time.Hour
	long := 90 * 24 * time.Hour
	require.NoError(t, AddOrgTimedQuota(1, 500, OrgTimedQuotaSourceMonthlyFree, "free", &short))
	require.NoError(t, AddOrgTimedQuota(1, 1000, OrgTimedQuotaSourceTopup, "topup", &long))
	require.NoError(t, AddOrgTimedQuota(1, 200, OrgTimedQuotaSourceAdmin, "perm", nil))

	deducted, err := DecreaseOrgQuotaByLedger(1, 600)
	require.NoError(t, err)
	require.NotEmpty(t, deducted)

	// 应优先扣 short(500),再扣 long(100)
	var shortLedger OrgTimedQuota
	require.NoError(t, DB.Where("source = ?", OrgTimedQuotaSourceMonthlyFree).First(&shortLedger).Error)
	assert.EqualValues(t, 0, shortLedger.Remaining, "短期应被先扣完")

	var longLedger OrgTimedQuota
	require.NoError(t, DB.Where("source = ?", OrgTimedQuotaSourceTopup).First(&longLedger).Error)
	assert.EqualValues(t, 900, longLedger.Remaining, "长期应剩 900")

	var permLedger OrgTimedQuota
	require.NoError(t, DB.Where("source = ?", OrgTimedQuotaSourceAdmin).First(&permLedger).Error)
	assert.EqualValues(t, 200, permLedger.Remaining, "永久行未动")

	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 600, org.UsedQuota)
}

func TestDecreaseOrgQuotaByLedger_RejectsInsufficient(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)
	require.NoError(t, AddOrgTimedQuota(1, 100, OrgTimedQuotaSourceTopup, "x", nil))

	_, err := DecreaseOrgQuotaByLedger(1, 200)
	assert.Error(t, err, "余额不足应报错")

	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 0, org.UsedQuota, "失败时 used_quota 不应被递增")
}

func TestRefundOrgQuotaByLedger_RestoresRemainingAndMirror(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)
	require.NoError(t, AddOrgTimedQuota(1, 1000, OrgTimedQuotaSourceTopup, "x", nil))

	deducted, err := DecreaseOrgQuotaByLedger(1, 300)
	require.NoError(t, err)

	require.NoError(t, RefundOrgQuotaByLedger(1, deducted))

	avail, _ := GetOrgAvailableQuota(1)
	assert.EqualValues(t, 1000, avail, "退款后剩余应回到 1000")

	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 0, org.UsedQuota)
}

func TestExpireOrgTimedQuotas_ZerosExpiredRowsAndUpdatesMirror(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)

	// 一笔已过期 + 一笔未过期
	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(48 * time.Hour)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 100, Remaining: 100, Source: "x", ExpiresAt: &past}).Error)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 200, Remaining: 200, Source: "y", ExpiresAt: &future}).Error)
	require.NoError(t, DB.Model(&Organization{}).Where("id = ?", 1).Update("quota", 300).Error)

	require.NoError(t, ExpireOrgTimedQuotas())

	var rows []OrgTimedQuota
	require.NoError(t, DB.Where("org_id = ?", 1).Find(&rows).Error)
	for _, r := range rows {
		if r.Source == "x" {
			assert.EqualValues(t, 0, r.Remaining, "过期行应被清零")
		}
		if r.Source == "y" {
			assert.EqualValues(t, 200, r.Remaining)
		}
	}
	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 200, org.Quota, "镜像列扣掉过期的 100")
}

func TestMigrateOrgQuotaToLedgerV0_Idempotent(t *testing.T) {
	setupOrgQuotaTestDB(t)
	require.NoError(t, DB.Create(&Organization{
		Id:            1,
		Name:          "ACME",
		Code:          "acme",
		Status:        OrgStatusEnabled,
		Group:         "default",
		Quota:         500,
		UsedQuota:     200,
		LoginUsername: "acme-login",
	}).Error)

	require.NoError(t, MigrateOrgQuotaToLedgerV0())

	var ledger []OrgTimedQuota
	require.NoError(t, DB.Where("org_id = ? AND source = ?", 1, OrgTimedQuotaSourceMigration).Find(&ledger).Error)
	require.Len(t, ledger, 1)
	assert.EqualValues(t, 300, ledger[0].Remaining, "(quota - used_quota) 入账本")

	// 重复执行不应重复插入
	require.NoError(t, MigrateOrgQuotaToLedgerV0())
	require.NoError(t, DB.Where("org_id = ? AND source = ?", 1, OrgTimedQuotaSourceMigration).Find(&ledger).Error)
	assert.Len(t, ledger, 1, "迁移函数必须幂等")
}

func TestGetOrgTimedQuotaAll_ReturnsAllRows(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)

	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(48 * time.Hour)
	// 有效行
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 1000, Remaining: 700, Source: OrgTimedQuotaSourceTopup, ExpiresAt: &future}).Error)
	// 已过期行
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 500, Remaining: 500, Source: OrgTimedQuotaSourceMonthlyFree, ExpiresAt: &past}).Error)
	// 已耗尽行(永久)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 200, Remaining: 0, Source: OrgTimedQuotaSourceAdmin}).Error)
	// 其它企业的行不应被返回
	newOrgForLedgerTest(t, 2)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 2, Amount: 999, Remaining: 999, Source: OrgTimedQuotaSourceTopup}).Error)

	rows, err := GetOrgTimedQuotaAll(1)
	require.NoError(t, err)
	assert.Len(t, rows, 3, "应返回全部行(含过期/耗尽),不含其它企业")
}

func TestGetOrgQuotaSummary_ExcludesExpiredAndComputesUsed(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)

	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(48 * time.Hour)
	// 有效:发放 1000,已用 300(remaining 700)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 1000, Remaining: 700, Source: OrgTimedQuotaSourceTopup, ExpiresAt: &future}).Error)
	// 有效永久:发放 200,已耗尽(remaining 0)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 200, Remaining: 0, Source: OrgTimedQuotaSourceAdmin}).Error)
	// 已过期:发放 500,不应计入有效总额
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 500, Remaining: 500, Source: OrgTimedQuotaSourceMonthlyFree, ExpiresAt: &past}).Error)

	validTotal, available, used, err := GetOrgQuotaSummary(1)
	require.NoError(t, err)
	assert.EqualValues(t, 1200, validTotal, "有效总额 = 未过期 SUM(amount) = 1000+200,排除过期 500")
	assert.EqualValues(t, 700, available, "可用 = 未过期 SUM(remaining) = 700(耗尽行 0 不计)")
	assert.EqualValues(t, 500, used, "已用 = 有效总额 - 可用 = 1200-700")
	assert.EqualValues(t, validTotal, available+used, "三者自洽")
}

func TestAttachOrgQuotaSummary_MatchesPerOrgSummary(t *testing.T) {
	setupOrgQuotaTestDB(t)
	newOrgForLedgerTest(t, 1)
	newOrgForLedgerTest(t, 2) // 无账本行,三值应为 0

	past := time.Now().Add(-1 * time.Hour)
	future := time.Now().Add(48 * time.Hour)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 1000, Remaining: 700, Source: OrgTimedQuotaSourceTopup, ExpiresAt: &future}).Error)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 200, Remaining: 0, Source: OrgTimedQuotaSourceAdmin}).Error)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 500, Remaining: 500, Source: OrgTimedQuotaSourceMonthlyFree, ExpiresAt: &past}).Error)

	org1, _ := GetOrgById(1)
	org2, _ := GetOrgById(2)
	rows, err := AttachOrgQuotaSummary([]*Organization{org1, org2})
	require.NoError(t, err)
	require.Len(t, rows, 2)

	// org1 应与逐企业 GetOrgQuotaSummary 完全一致
	vt, av, used, _ := GetOrgQuotaSummary(1)
	assert.EqualValues(t, vt, rows[0].ValidTotal)
	assert.EqualValues(t, av, rows[0].Available)
	assert.EqualValues(t, used, rows[0].Used)
	assert.EqualValues(t, 1200, rows[0].ValidTotal)
	assert.EqualValues(t, 700, rows[0].Available)
	assert.EqualValues(t, 500, rows[0].Used)

	// org2 无账本行 → 三值 0
	assert.EqualValues(t, 0, rows[1].ValidTotal)
	assert.EqualValues(t, 0, rows[1].Available)
	assert.EqualValues(t, 0, rows[1].Used)
}

func setupOrgReconcileTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&Organization{},
		&OrgTimedQuota{},
		&OrgMember{},
	))
	DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
}

// 账本可用与镜像 quota-used 一致、成员用量之和与企业已用一致时,对账应无漂移.
func TestReconcileOrgQuotaMirrors_NoDrift(t *testing.T) {
	setupOrgReconcileTestDB(t)
	require.NoError(t, DB.Create(&Organization{
		Id: 1, Name: "A", Code: "c1", Status: OrgStatusEnabled, LoginUsername: "l1",
		Quota: 1000, UsedQuota: 300,
	}).Error)
	// 账本可用 = 700 == quota-used = 700
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 1000, Remaining: 700, Source: "topup"}).Error)
	// 成员用量之和 = 300 == 企业 used_quota
	require.NoError(t, DB.Create(&OrgMember{OrgId: 1, UserId: 1, Role: OrgRoleMember, Status: OrgMemberStatusEnabled, UsedQuota: 200}).Error)
	require.NoError(t, DB.Create(&OrgMember{OrgId: 1, UserId: 2, Role: OrgRoleMember, Status: OrgMemberStatusEnabled, UsedQuota: 100}).Error)

	drifts, err := ReconcileOrgQuotaMirrors()
	require.NoError(t, err)
	assert.Empty(t, drifts)
}

// 镜像 quota/used_quota 都应被重算到账本口径:
// quota=valid_total(未过期 SUM amount),used_quota=valid_total-可用.
func TestReconcileOrgQuotaMirrors_HealsUsedQuotaToLedger(t *testing.T) {
	setupOrgReconcileTestDB(t)
	require.NoError(t, DB.Create(&Organization{
		Id: 1, Name: "A", Code: "c1", Status: OrgStatusEnabled, LoginUsername: "l1",
		// 镜像列都漂了:quota 偏大(含已过期批次的历史),used_quota 也偏
		Quota: 2000, UsedQuota: 1500,
	}).Error)
	// 账本未过期:发放 1200,可用 700 → 账本 used=500
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 1200, Remaining: 700, Source: "topup"}).Error)

	drifts, err := ReconcileOrgQuotaMirrors()
	require.NoError(t, err)
	require.Len(t, drifts, 1)
	assert.True(t, drifts[0].AvailFixed)
	assert.EqualValues(t, 1200, drifts[0].LedgerValidTotal)
	assert.EqualValues(t, 500, drifts[0].LedgerUsed)

	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 1200, org.Quota, "quota 应重算为账本有效总额")
	assert.EqualValues(t, 500, org.UsedQuota, "used_quota 应重算为账本口径已用")
	assert.EqualValues(t, 700, org.Quota-org.UsedQuota, "镜像可用 == 账本可用")
}

// 可用余额漂移(过期清理导致账本 remaining 减少但 quota 未同步)应被自愈:
// 镜像 quota/used_quota 都重算到账本口径(valid_total / valid_total-可用).
func TestReconcileOrgQuotaMirrors_FixesAvailDrift(t *testing.T) {
	setupOrgReconcileTestDB(t)
	require.NoError(t, DB.Create(&Organization{
		Id: 1, Name: "A", Code: "c1", Status: OrgStatusEnabled, LoginUsername: "l1",
		Quota: 1000, UsedQuota: 300, // 镜像可用 = 700
	}).Error)
	// 但账本实际只剩 500(比如有 200 被消耗但镜像未同步):valid_total=1000,可用=500,已用=500
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 1000, Remaining: 500, Source: "topup"}).Error)

	drifts, err := ReconcileOrgQuotaMirrors()
	require.NoError(t, err)
	require.Len(t, drifts, 1)
	assert.True(t, drifts[0].AvailFixed)
	assert.EqualValues(t, 500, drifts[0].LedgerAvail)
	assert.EqualValues(t, 700, drifts[0].MirrorAvail)
	assert.EqualValues(t, 1000, drifts[0].LedgerValidTotal)
	assert.EqualValues(t, 500, drifts[0].LedgerUsed)

	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 1000, org.Quota, "quota 应重算为账本有效总额")
	assert.EqualValues(t, 500, org.UsedQuota, "used_quota 应重算为账本口径已用")
	// 修正后镜像可用 = 1000-500 = 500 == 账本可用
	assert.EqualValues(t, 500, org.Quota-org.UsedQuota)
}

// 成员 used_quota 之和 != 企业 used_quota 时仅告警,不修改任何列.
func TestReconcileOrgQuotaMirrors_MemberMismatchWarnOnly(t *testing.T) {
	setupOrgReconcileTestDB(t)
	require.NoError(t, DB.Create(&Organization{
		Id: 1, Name: "A", Code: "c1", Status: OrgStatusEnabled, LoginUsername: "l1",
		Quota: 1000, UsedQuota: 300,
	}).Error)
	require.NoError(t, DB.Create(&OrgTimedQuota{OrgId: 1, Amount: 1000, Remaining: 700, Source: "topup"}).Error)
	// 成员之和 = 250 != 企业 used_quota 300(消费链路某步落库失败)
	require.NoError(t, DB.Create(&OrgMember{OrgId: 1, UserId: 1, Role: OrgRoleMember, Status: OrgMemberStatusEnabled, UsedQuota: 250}).Error)

	drifts, err := ReconcileOrgQuotaMirrors()
	require.NoError(t, err)
	require.Len(t, drifts, 1)
	assert.False(t, drifts[0].AvailFixed, "可用余额一致,不应修正")
	assert.True(t, drifts[0].MemberMismatch)
	assert.EqualValues(t, 250, drifts[0].MemberUsedSum)
	assert.EqualValues(t, 300, drifts[0].LedgerUsed)

	// 不应改动任何列
	var org Organization
	require.NoError(t, DB.Where("id = ?", 1).First(&org).Error)
	assert.EqualValues(t, 1000, org.Quota)
	assert.EqualValues(t, 300, org.UsedQuota)
}
