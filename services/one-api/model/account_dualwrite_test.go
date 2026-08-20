package model

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 回归测试：直写 users 的几个函数（UpdateUserPhone/ClearUserPhone/ClearUserWeChat/
// ResetUserPasswordByEmail）绕过 User.Update，曾漏掉账号中心双写，导致换手机号后账号中心
// phone 标识停留旧值。本测试锁死「这些函数必须同步账号中心」。

func TestUpdateUserPhone_同步账号中心(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	u := &User{Username: "alice", Phone: "+8613800000000", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_a", AffCode: "aff_a"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 换手机号（走直写函数，非 User.Update）
	require.NoError(t, UpdateUserPhone(u.Id, "+8613900000000"))

	var phone AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ? AND type = ?", accID, IdentifierTypePhone).First(&phone).Error)
	assert.Equal(t, "+8613900000000", phone.Identifier, "换手机号后账号中心 phone 标识必须同步,不能停留旧值")
}

func TestClearUserPhone_同步账号中心(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	u := &User{Username: "bob", Phone: "+8613800000001", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_b", AffCode: "aff_b"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	require.NoError(t, ClearUserPhone(u.Id))

	var cnt int64
	accDB.Model(&AccountIdentifier{}).Where("account_id = ? AND type = ?", accID, IdentifierTypePhone).Count(&cnt)
	assert.Equal(t, int64(0), cnt, "解绑手机号后账号中心 phone 标识应被移除")
}

func TestClearUserWeChat_同步账号中心(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	u := &User{Username: "carol", WeChatId: "wx_c", Status: UserStatusEnabled, AccessToken: "tok_c", AffCode: "aff_c"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	require.NoError(t, ClearUserWeChat(u.Id))

	var cnt int64
	accDB.Model(&AccountIdentifier{}).Where("account_id = ? AND type = ?", accID, IdentifierTypeWeChat).Count(&cnt)
	assert.Equal(t, int64(0), cnt, "解绑微信后账号中心 wechat 标识应被移除")
}

// 回归: accounts.status 必须随 users.status 持续刷新, 否则 disable/enable 变更不会
// 进账号中心(原实现是 OnConflict DoNothing, 状态首次写入后再不更新).
func TestEnsureAccountForUser_状态刷新(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	u := &User{Username: "dan", Status: UserStatusEnabled, AccessToken: "tok_d", AffCode: "aff_d"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	var acc Account
	require.NoError(t, accDB.First(&acc, "id = ?", accID).Error)
	assert.Equal(t, AccountStatusEnabled, acc.Status)

	// 禁用 → 再投影应刷新 status
	u.Status = UserStatusDisabled
	_, err = EnsureAccountForUser(u)
	require.NoError(t, err)
	require.NoError(t, accDB.First(&acc, "id = ?", accID).Error)
	assert.Equal(t, AccountStatusDisabled, acc.Status, "users.status 改 Disabled 后账号中心必须同步")
}

// 回归: User.Delete 必须清账号中心受管 identifier, 并把 accounts.status 置为 Deleted.
// 旧实现完全没动账号中心, 删一个再注册一个同名用户会因 uk_type_identifier 撞键失效.
func TestUserDelete_清账号中心(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	u := &User{Username: "eve", Phone: "+8613800006666", PhoneVerified: true, WeChatId: "wx_e", Status: UserStatusEnabled, AccessToken: "tok_e", AffCode: "aff_e"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	require.NoError(t, u.Delete())

	// 受管 identifier 全部清空
	var idCnt int64
	accDB.Model(&AccountIdentifier{}).Where("account_id = ? AND type IN ?", accID,
		[]string{IdentifierTypeUsername, IdentifierTypePhone, IdentifierTypeWeChat}).Count(&idCnt)
	assert.Equal(t, int64(0), idCnt, "Delete 后受管 identifier 必须清空, 否则同号再注册会撞键")

	// accounts.status = Deleted
	var acc Account
	require.NoError(t, accDB.First(&acc, "id = ?", accID).Error)
	assert.Equal(t, AccountStatusDeleted, acc.Status, "accounts.status 应同步为 Deleted")

	// 同手机号再注册: 新账号能拿到 phone 标识(旧标识已让位)
	u2 := &User{Username: "eve2", Phone: "+8613800006666", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_e2", AffCode: "aff_e2"}
	require.NoError(t, mainDB.Create(u2).Error)
	accID2, err := EnsureAccountForUser(u2)
	require.NoError(t, err)
	require.NotEqual(t, accID, accID2)
	var phone AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ? AND type = ?", accID2, IdentifierTypePhone).First(&phone).Error)
	assert.Equal(t, "+8613800006666", phone.Identifier)
}

// 回归: SyncAccountProfileByUserID 是 B 类档案的业务层入口, 写完应能从账号中心读出新值,
// 且未投影用户调用应静默 no-op (不创建孤儿 profile).
func TestSyncAccountProfileByUserID_写收口(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	u := &User{Username: "frank", DisplayName: "Frank", Status: UserStatusEnabled, AccessToken: "tok_f", AffCode: "aff_f"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 改昵称应能从账号中心读出新值
	SyncAccountProfileByUserID(u.Id, "Frank New", "", "test")
	p, err := GetAccountProfile(accID)
	require.NoError(t, err)
	require.NotNil(t, p)
	assert.Equal(t, "Frank New", p.DisplayName, "档案写收口应同步到账号中心")

	// 未投影用户(尚未跑过 EnsureAccountForUser)调用应静默 no-op, 不报错也不建孤儿
	u2 := &User{Username: "ghost", DisplayName: "Ghost", Status: UserStatusEnabled, AccessToken: "tok_g", AffCode: "aff_g"}
	require.NoError(t, mainDB.Create(u2).Error)
	SyncAccountProfileByUserID(u2.Id, "Ghost New", "", "test")
}

// 阶段 1 回归: User.Insert 时停写 users.display_name, 改写到账号中心档案.
func TestUserInsert_DisplayName单源化(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{Username: "henry", DisplayName: "Henry From Insert", Status: UserStatusEnabled}
	require.NoError(t, u.Insert(context.Background(), 0))

	// users.display_name 必须为空 (停写)
	var reloaded User
	require.NoError(t, mainDB.First(&reloaded, "id = ?", u.Id).Error)
	assert.Equal(t, "", reloaded.DisplayName, "users.display_name 必须停写")

	// 账号中心 account_profiles.display_name 必须有真值
	require.NotNil(t, u.AccountId)
	var p AccountProfile
	require.NoError(t, accDB.First(&p, "account_id = ?", *u.AccountId).Error)
	assert.Equal(t, "Henry From Insert", p.DisplayName, "display_name 必须落到账号中心档案")

	// 内存对象保留 DisplayName,SetupLogin/cleanUser 不会因停写返回空
	assert.Equal(t, "Henry From Insert", u.DisplayName, "Insert 后内存对象保留 display_name")
}

// 阶段 1 回归: User.Update 时不再覆盖 users.display_name, 真正修改通过
// SyncAccountProfileByUserID 落到账号中心 (在 controller.UpdateSelf 里调).
func TestUserUpdate_停写_DisplayName(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{Username: "iris", DisplayName: "Iris Old", Status: UserStatusEnabled}
	require.NoError(t, u.Insert(context.Background(), 0))

	// 调用方传 cleanUser 改昵称(模拟 controller.UpdateSelf 行为)
	cleanUser := User{Id: u.Id, DisplayName: "Iris New"}
	require.NoError(t, cleanUser.Update(false))

	// users.display_name 必须保持空 (停写覆盖路径)
	var reloaded User
	require.NoError(t, mainDB.First(&reloaded, "id = ?", u.Id).Error)
	assert.Equal(t, "", reloaded.DisplayName, "User.Update 不能动 users.display_name")
}

// 阶段 1 回归: ResolveUserDisplayName 三态回退.
func TestResolveUserDisplayName_三态(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{Username: "jack", DisplayName: "Jack", Status: UserStatusEnabled}
	require.NoError(t, u.Insert(context.Background(), 0))

	// 命中
	assert.Equal(t, "Jack", ResolveUserDisplayName(u.AccountId, "fallback"))

	// 未迁移 -> fallback
	assert.Equal(t, "fallback", ResolveUserDisplayName(nil, "fallback"))

	// 账号中心未启用 -> fallback
	orig := ACCOUNT_DB
	ACCOUNT_DB = nil
	assert.Equal(t, "fallback", ResolveUserDisplayName(u.AccountId, "fallback"))
	ACCOUNT_DB = orig
}
