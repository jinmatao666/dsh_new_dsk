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

func setupAccountTypeTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&User{},
		&UserTimedQuota{},
		&Organization{},
		&OrgMember{},
		&OrgMemberLimit{},
		&Subscription{},
		&AccountTypeChange{},
		&Log{},
	))
	DB = db
	LOG_DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
}

func seedAccountTypeUser(t *testing.T, id int, username string, accountType int, role int) *User {
	t.Helper()
	user := User{
		Id:          id,
		Username:    username,
		Email:       username + "@example.com",
		Status:      UserStatusEnabled,
		Role:        role,
		AccountType: accountType,
		AccessToken: username + "-tk",
		AffCode:     username + "-aff",
	}
	require.NoError(t, DB.Create(&user).Error)
	return &user
}

func seedOrg(t *testing.T, id int, name string, status int) *Organization {
	t.Helper()
	org := Organization{
		Id:            id,
		Name:          name,
		Code:          name + "-code",
		Status:        status,
		Group:         "default",
		LoginUsername: name + "-login",
	}
	require.NoError(t, DB.Create(&org).Error)
	return &org
}

func TestTransferToEnterprise_Success_ZerosLedgerAndCancelsSubscriptions(t *testing.T) {
	setupAccountTypeTestDB(t)
	seedAccountTypeUser(t, 10, "alice", AccountTypePersonal, RoleCommonUser)
	seedOrg(t, 7, "ACME", OrgStatusEnabled)

	require.NoError(t, AddUserTimedQuota(10, 500, TimedQuotaSourceMonthlyFree, "ref-free", nil))
	require.NoError(t, AddUserTimedQuota(10, 1000, TimedQuotaSourceTopup, "ref-topup", nil))
	require.NoError(t, DB.Create(&Subscription{
		UserId:             10,
		PackageId:          1,
		BillingCycle:       "monthly",
		Status:             "active",
		QuotaPerPeriod:     800,
		PeriodsTotal:       12,
		CurrentPeriodStart: time.Now(),
		CurrentPeriodEnd:   time.Now().Add(30 * 24 * time.Hour),
	}).Error)

	require.NoError(t, TransferToEnterprise(99, 10, 7, OrgRoleMember, "test"))

	var u User
	require.NoError(t, DB.Where("id = ?", 10).First(&u).Error)
	assert.Equal(t, AccountTypeEnterprise, u.AccountType)
	assert.Equal(t, 7, u.OrgId)
	assert.EqualValues(t, 0, u.Quota)
	assert.EqualValues(t, 0, u.SubscriptionQuota)
	assert.EqualValues(t, 0, u.TimedQuotaTotal)

	var liveCount int64
	require.NoError(t, DB.Model(&UserTimedQuota{}).Where("user_id = ? AND remaining > 0", 10).Count(&liveCount).Error)
	assert.EqualValues(t, 0, liveCount, "ledger 中所有 remaining 必须清零")

	var activeSubCount int64
	require.NoError(t, DB.Model(&Subscription{}).Where("user_id = ? AND status = 'active'", 10).Count(&activeSubCount).Error)
	assert.EqualValues(t, 0, activeSubCount, "active 订阅必须被 cancel")

	var memberCount int64
	require.NoError(t, DB.Model(&OrgMember{}).Where("org_id = ? AND user_id = ?", 7, 10).Count(&memberCount).Error)
	assert.EqualValues(t, 1, memberCount)

	var auditCount int64
	require.NoError(t, DB.Model(&AccountTypeChange{}).Where("user_id = ? AND direction = ?", 10, AccountTypeChangePersonalToEnt).Count(&auditCount).Error)
	assert.EqualValues(t, 1, auditCount)
}

func TestTransferToEnterprise_RejectsRootUser(t *testing.T) {
	setupAccountTypeTestDB(t)
	seedAccountTypeUser(t, 1, "root", AccountTypePersonal, RoleRootUser)
	seedOrg(t, 1, "ACME", OrgStatusEnabled)

	err := TransferToEnterprise(99, 1, 1, OrgRoleMember, "test")
	assert.Error(t, err)
}

func TestTransferToEnterprise_RejectsExistingEnterprise(t *testing.T) {
	setupAccountTypeTestDB(t)
	seedOrg(t, 1, "ACME", OrgStatusEnabled)
	seedOrg(t, 2, "BCO", OrgStatusEnabled)
	u := seedAccountTypeUser(t, 1, "bob", AccountTypePersonal, RoleCommonUser)
	require.NoError(t, TransferToEnterprise(99, u.Id, 1, OrgRoleMember, "first"))

	err := TransferToEnterprise(99, u.Id, 2, OrgRoleMember, "second")
	assert.Error(t, err, "已是企业身份的用户不能直接再次转入")
}

func TestTransferToPersonal_RestoresPersonalIdentity(t *testing.T) {
	setupAccountTypeTestDB(t)
	seedOrg(t, 1, "ACME", OrgStatusEnabled)
	u := seedAccountTypeUser(t, 1, "carol", AccountTypePersonal, RoleCommonUser)
	require.NoError(t, TransferToEnterprise(99, u.Id, 1, OrgRoleMember, "in"))

	require.NoError(t, TransferToPersonal(99, u.Id, "out"))

	var refreshed User
	require.NoError(t, DB.Where("id = ?", u.Id).First(&refreshed).Error)
	assert.Equal(t, AccountTypePersonal, refreshed.AccountType)
	assert.Equal(t, 0, refreshed.OrgId)

	var memberCount int64
	require.NoError(t, DB.Model(&OrgMember{}).Where("user_id = ?", u.Id).Count(&memberCount).Error)
	assert.EqualValues(t, 0, memberCount, "出企后 org_members 行被删除")

	var changeCount int64
	require.NoError(t, DB.Model(&AccountTypeChange{}).Where("user_id = ? AND direction = ?", u.Id, AccountTypeChangeEnterpriseToPer).Count(&changeCount).Error)
	assert.EqualValues(t, 1, changeCount)
}

func TestTransferToPersonal_RejectsAlreadyPersonal(t *testing.T) {
	setupAccountTypeTestDB(t)
	u := seedAccountTypeUser(t, 1, "dave", AccountTypePersonal, RoleCommonUser)

	err := TransferToPersonal(99, u.Id, "out")
	assert.Error(t, err)
}

// P0-1 回归:已存在的 owner 行被重新 upsert(迁移/重复加入)时不得降级为 member,
// 否则企业会失去唯一 owner,且"不能转出所有者"防线随之失效。
func TestUpsertOrgMember_PreservesOwnerOnReentry(t *testing.T) {
	setupAccountTypeTestDB(t)
	seedOrg(t, 1, "ACME", OrgStatusEnabled)
	// 预置一条 owner 行,并带上部门归属
	require.NoError(t, DB.Create(&OrgMember{
		OrgId: 1, UserId: 5, Role: OrgRoleOwner, DeptId: 9,
		QuotaLimit: -1, Status: OrgMemberStatusEnabled,
	}).Error)

	// 以 member 角色重新 upsert(模拟迁移把所有人按 member 迁入)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return upsertOrgMemberTx(tx, 1, 5, OrgRoleMember)
	}))

	var m OrgMember
	require.NoError(t, DB.Where("org_id = ? AND user_id = ?", 1, 5).First(&m).Error)
	assert.Equal(t, OrgRoleOwner, m.Role, "owner 不能被降级为 member")
	assert.Equal(t, 9, m.DeptId, "恢复已存在行不得清空部门归属")
}

func TestVerifyAccountTypeInvariants_DetectsViolations(t *testing.T) {
	setupAccountTypeTestDB(t)
	// 故意构造一条违规数据:enterprise 但 org_id=0
	require.NoError(t, DB.Create(&User{
		Id:          5,
		Username:    "bad",
		Email:       "bad@example.com",
		Status:      UserStatusEnabled,
		Role:        RoleCommonUser,
		AccountType: AccountTypeEnterprise,
		OrgId:       0,
		AccessToken: "bad-tk",
		AffCode:     "bad-aff",
	}).Error)

	hits, err := VerifyAccountTypeInvariants(10)
	require.NoError(t, err)
	assert.NotEmpty(t, hits)
}

func TestAddUserTimedQuota_RejectsEnterpriseAccount(t *testing.T) {
	setupAccountTypeTestDB(t)
	seedOrg(t, 1, "ACME", OrgStatusEnabled)
	require.NoError(t, DB.Create(&User{
		Id:          7,
		Username:    "ent",
		Email:       "ent@x",
		Status:      UserStatusEnabled,
		Role:        RoleCommonUser,
		AccountType: AccountTypeEnterprise,
		OrgId:       1,
		AccessToken: "ent-tk",
		AffCode:     "ent-aff",
	}).Error)

	err := AddUserTimedQuota(7, 100, TimedQuotaSourceTopup, "test", nil)
	assert.Error(t, err, "企业账户必须拒绝个人积分写入")

	var count int64
	require.NoError(t, DB.Model(&UserTimedQuota{}).Where("user_id = ?", 7).Count(&count).Error)
	assert.EqualValues(t, 0, count, "拒绝时不应留下半成品账本行")
}

func TestIssueMonthlyFreeQuotas_SkipsEnterpriseAccounts(t *testing.T) {
	setupAccountTypeTestDB(t)
	// 免费额度由「试用包」决定:插入个人套餐 price=0、Point=0.5 → 0.5×QuotaPerUnit(1000)=500
	require.NoError(t, DB.AutoMigrate(&RechargePackage{}))
	require.NoError(t, DB.Create(&RechargePackage{
		Name: "试用版", Scope: RechargeScopePersonal, Price: 0, Point: 0.5, Enabled: true,
	}).Error)

	old := time.Now().Add(-90 * 24 * time.Hour)
	// personal 用户 — 应被发放
	require.NoError(t, DB.Create(&User{
		Id: 1, Username: "p1", Email: "p1@x", Status: UserStatusEnabled, AccountType: AccountTypePersonal,
		AccessToken: "p1-tk", AffCode: "p1-aff", LastFreeQuotaAt: &old,
	}).Error)
	// enterprise 用户 — 应被排除
	seedOrg(t, 1, "ACME", OrgStatusEnabled)
	require.NoError(t, DB.Create(&User{
		Id: 2, Username: "e1", Email: "e1@x", Status: UserStatusEnabled, AccountType: AccountTypeEnterprise, OrgId: 1,
		AccessToken: "e1-tk", AffCode: "e1-aff", LastFreeQuotaAt: &old,
	}).Error)

	require.NoError(t, IssueMonthlyFreeQuotas())

	var p1 User
	require.NoError(t, DB.Where("id = ?", 1).First(&p1).Error)
	assert.Greater(t, p1.SubscriptionQuota, int64(0), "个体用户应拿到月免费")

	var e1 User
	require.NoError(t, DB.Where("id = ?", 2).First(&e1).Error)
	assert.EqualValues(t, 0, e1.SubscriptionQuota, "企业用户必须被排除")
}
