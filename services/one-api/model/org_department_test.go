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

func setupOrgDeptTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&Organization{},
		&OrgMember{},
		&OrgDepartment{},
		&OrgMemberLimit{},
	))
	DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
}

func TestOrgDepartment_CreateUpdateDelete(t *testing.T) {
	setupOrgDeptTestDB(t)
	root, err := CreateOrgDepartment(1, 0, "研发", OrgDeptBudgetShared, -1, 0)
	require.NoError(t, err)
	child, err := CreateOrgDepartment(1, root.Id, "后端组", OrgDeptBudgetCapped, 1000, 0)
	require.NoError(t, err)

	// 父部门指向自己的子部门应被拒绝(防环)
	err = UpdateOrgDepartment(1, root.Id, child.Id, "研发", OrgDeptBudgetShared, -1, 0, OrgDeptStatusEnabled)
	assert.Error(t, err)

	// 有子部门时删除父部门应被拒绝
	err = DeleteOrgDepartment(1, root.Id)
	assert.Error(t, err)

	// 删除叶子 OK
	require.NoError(t, DeleteOrgDepartment(1, child.Id))
	require.NoError(t, DeleteOrgDepartment(1, root.Id))

	depts, err := GetOrgDepartments(1)
	require.NoError(t, err)
	assert.Len(t, depts, 0)
}

func TestOrgDeptBudget_CappedAncestorBlocks(t *testing.T) {
	setupOrgDeptTestDB(t)
	root, err := CreateOrgDepartment(1, 0, "市场", OrgDeptBudgetCapped, 1000, 0)
	require.NoError(t, err)
	child, err := CreateOrgDepartment(1, root.Id, "华东", OrgDeptBudgetShared, -1, 0)
	require.NoError(t, err)

	// 子部门花费会累加到 capped 祖先,500 在上限内
	require.NoError(t, CheckOrgDeptBudget(1, child.Id, 500))
	require.NoError(t, ApplyOrgDeptUsage(nil, 1, child.Id, 500))

	// 再花 600 会让祖先累计到 1100 > 1000,拒绝
	assert.Error(t, CheckOrgDeptBudget(1, child.Id, 600))
	// 400 仍在上限内
	require.NoError(t, CheckOrgDeptBudget(1, child.Id, 400))

	// 验证用量累加到了链上每一级
	var r OrgDepartment
	require.NoError(t, DB.First(&r, root.Id).Error)
	assert.EqualValues(t, 500, r.UsedQuota)
	var ch OrgDepartment
	require.NoError(t, DB.First(&ch, child.Id).Error)
	assert.EqualValues(t, 500, ch.UsedQuota)

	// 退款回滚
	require.NoError(t, ApplyOrgDeptUsage(nil, 1, child.Id, -500))
	require.NoError(t, DB.First(&r, root.Id).Error)
	assert.EqualValues(t, 0, r.UsedQuota)
}

func TestOrgDeptBudget_SharedNeverBlocks(t *testing.T) {
	setupOrgDeptTestDB(t)
	d, err := CreateOrgDepartment(1, 0, "销售", OrgDeptBudgetShared, 100, 0)
	require.NoError(t, err)
	// shared 模式即使超 cap 也不拦
	require.NoError(t, ApplyOrgDeptUsage(nil, 1, d.Id, 999))
	require.NoError(t, CheckOrgDeptBudget(1, d.Id, 999))
}

func TestOrgMemberLimit_DailyMonthlyEnforced(t *testing.T) {
	setupOrgDeptTestDB(t)
	require.NoError(t, SetOrgMemberLimit(1, 7, 100, 500))

	// 日上限内
	require.NoError(t, CheckOrgMemberLimit(1, 7, 80))
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 7, 80))
	// 再花 30 会突破日上限 100
	assert.Error(t, CheckOrgMemberLimit(1, 7, 30))
	// 20 仍可
	require.NoError(t, CheckOrgMemberLimit(1, 7, 20))

	limit, err := GetOrgMemberLimit(1, 7)
	require.NoError(t, err)
	assert.EqualValues(t, 80, limit.DailyUsed)
	assert.EqualValues(t, 80, limit.MonthlyUsed)
}

func TestOrgMemberLimit_ZeroCapForbids(t *testing.T) {
	setupOrgDeptTestDB(t)
	require.NoError(t, SetOrgMemberLimit(1, 9, 0, -1))
	assert.Error(t, CheckOrgMemberLimit(1, 9, 1))
}

func TestOrgMemberLimit_NoRowMeansUnlimited(t *testing.T) {
	setupOrgDeptTestDB(t)
	// 未设限额的成员不受限,也不会被 IncrOrgMemberUsed 凭空建行
	require.NoError(t, CheckOrgMemberLimit(1, 100, 999999))
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 100, 500))
	limit, err := GetOrgMemberLimit(1, 100)
	require.NoError(t, err)
	assert.Nil(t, limit)
}

func TestOrgMemberLimit_DailyResetZeroesUsed(t *testing.T) {
	setupOrgDeptTestDB(t)
	require.NoError(t, SetOrgMemberLimit(1, 5, 100, 1000))
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 5, 90))

	// 把 daily_reset_at 强制拨到过去,模拟跨日
	past := time.Now().Add(-time.Hour)
	require.NoError(t, DB.Model(&OrgMemberLimit{}).Where("org_id = ? AND user_id = ?", 1, 5).
		Update("daily_reset_at", &past).Error)

	require.NoError(t, ResetOrgMemberDailyUsed())
	limit, err := GetOrgMemberLimit(1, 5)
	require.NoError(t, err)
	assert.EqualValues(t, 0, limit.DailyUsed)
	assert.EqualValues(t, 90, limit.MonthlyUsed, "月计数不受日重置影响")
	assert.True(t, limit.DailyResetAt.After(time.Now()), "重置点应顺延到未来")
}

func TestOrgMemberLimit_LazyResetOnCheck(t *testing.T) {
	setupOrgDeptTestDB(t)
	require.NoError(t, SetOrgMemberLimit(1, 6, 100, 1000))
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 6, 95))

	// daily_reset_at 拨到过去,cron 未跑;CheckOrgMemberLimit 应视当日已用为 0
	past := time.Now().Add(-time.Hour)
	require.NoError(t, DB.Model(&OrgMemberLimit{}).Where("org_id = ? AND user_id = ?", 1, 6).
		Update("daily_reset_at", &past).Error)

	// 若不做惰性重置,95+50 会超 100;惰性重置后视作 0+50 通过
	require.NoError(t, CheckOrgMemberLimit(1, 6, 50))
}

func TestOrgMemberLimit_IncrZeroesOnPassedResetPoint(t *testing.T) {
	setupOrgDeptTestDB(t)
	require.NoError(t, SetOrgMemberLimit(1, 8, 100, 1000))
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 8, 90))

	// 把日重置点拨到过去,模拟跨日后 cron 尚未运行
	past := time.Now().Add(-time.Hour)
	require.NoError(t, DB.Model(&OrgMemberLimit{}).Where("org_id = ? AND user_id = ?", 1, 8).
		Update("daily_reset_at", &past).Error)

	// 再次累加:应先把 daily_used 归零(条件重置)再 +30,得到 30 而非 120
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 8, 30))
	limit, err := GetOrgMemberLimit(1, 8)
	require.NoError(t, err)
	assert.EqualValues(t, 30, limit.DailyUsed, "跨日后日计数应重置再累加")
	assert.EqualValues(t, 120, limit.MonthlyUsed, "月计数未跨重置点,应持续累加")
	assert.True(t, limit.DailyResetAt.After(time.Now()), "日重置点应顺延到未来")
}

func TestOrgMemberLimit_IncrAccumulatesAtomically(t *testing.T) {
	setupOrgDeptTestDB(t)
	require.NoError(t, SetOrgMemberLimit(1, 11, -1, -1))
	// 顺序多次累加,验证用的是原子自增而非覆盖写
	for i := 0; i < 5; i++ {
		require.NoError(t, IncrOrgMemberUsed(nil, 1, 11, 10))
	}
	limit, err := GetOrgMemberLimit(1, 11)
	require.NoError(t, err)
	assert.EqualValues(t, 50, limit.DailyUsed)
	assert.EqualValues(t, 50, limit.MonthlyUsed)

	// 退款(负数)应原子递减且不低于 0
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 11, -30))
	limit, err = GetOrgMemberLimit(1, 11)
	require.NoError(t, err)
	assert.EqualValues(t, 20, limit.DailyUsed)
	require.NoError(t, IncrOrgMemberUsed(nil, 1, 11, -999))
	limit, err = GetOrgMemberLimit(1, 11)
	require.NoError(t, err)
	assert.EqualValues(t, 0, limit.DailyUsed, "退款递减不应低于 0")
}
