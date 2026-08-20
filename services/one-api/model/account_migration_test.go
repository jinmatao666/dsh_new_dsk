package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common/snowflake"
)

func setupAccountTestDB(t *testing.T) (mainDB, accDB *gorm.DB) {
	require.NoError(t, snowflake.Init(0))

	var err error
	// 每个测试用独立内存库（DSN 带测试名），避免 cache=shared 跨测试串数据。
	mainDB, err = gorm.Open(sqlite.Open("file:main_"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, mainDB.AutoMigrate(&User{}))

	accDB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, accDB.AutoMigrate(&Account{}, &AccountIdentifier{}, &AccountCredential{}, &AccountProduct{}, &AccountProfile{}))

	// 注入包级连接，迁移函数读这两个全局变量。测试结束恢复。
	origDB, origAcc := DB, ACCOUNT_DB
	DB, ACCOUNT_DB = mainDB, accDB
	t.Cleanup(func() { DB, ACCOUNT_DB = origDB, origAcc })
	return mainDB, accDB
}

func TestEnsureAccountForUser_投影与镜像换绑(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	u := &User{Username: "alice", Password: "h1", Phone: "+8613800000000", PhoneVerified: true, WeChatId: "wx_a", GitHubId: "gh_1", Status: UserStatusEnabled, AccessToken: "tok_a", AffCode: "aff_a"}
	require.NoError(t, mainDB.Create(u).Error)

	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)
	require.NotZero(t, accID)
	require.NotNil(t, u.AccountId)
	assert.Equal(t, accID, *u.AccountId)

	countType := func(typ string) int64 {
		var n int64
		accDB.Model(&AccountIdentifier{}).Where("account_id = ? AND type = ?", accID, typ).Count(&n)
		return n
	}
	assert.Equal(t, int64(1), countType(IdentifierTypeUsername))
	assert.Equal(t, int64(1), countType(IdentifierTypePhone))
	assert.Equal(t, int64(1), countType(IdentifierTypeWeChat))
	assert.Equal(t, int64(1), countType(IdentifierTypeGitHub)) // 历史类型也迁

	// 换手机号：受管类型镜像新值，不残留旧号
	u.Phone = "+8613900000000"
	_, err = EnsureAccountForUser(u)
	require.NoError(t, err)
	var phones []AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ? AND type = ?", accID, IdentifierTypePhone).Find(&phones).Error)
	require.Len(t, phones, 1)
	assert.Equal(t, "+8613900000000", phones[0].Identifier, "旧手机号不应残留")

	// 改密：credential 刷新
	u.Password = "h2"
	_, err = EnsureAccountForUser(u)
	require.NoError(t, err)
	var cred AccountCredential
	require.NoError(t, accDB.First(&cred, "account_id = ?", accID).Error)
	assert.Equal(t, "h2", cred.PasswordHash)

	// account_id 已定，重复投影不新建账号
	var accounts int64
	accDB.Model(&Account{}).Count(&accounts)
	assert.Equal(t, int64(1), accounts)
}

// 回归：模拟「账号库事务成功、但回填 users.account_id 失败」后的重试。
// 此时 users.account_id 仍为 NULL，旧实现会信内存 u.AccountId(nil) 再 NextID() 建第二个
// 账号 → 孤儿账号 + 重复 parvis 映射。修复后应以账号库 (parvis, local_user_id) 映射为
// 权威来源复用原账号，账号数与映射数都保持 1。
func TestEnsureAccountForUser_回填失败重试不建重复账号(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	u := &User{Username: "erin", Password: "h1", Phone: "+8613811112222", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_e", AffCode: "aff_e"}
	require.NoError(t, mainDB.Create(u).Error)

	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)
	require.NotZero(t, accID)

	// 模拟回填失败：把 users.account_id 抹回 NULL，且清掉内存里的引用。
	require.NoError(t, mainDB.Model(&User{}).Where("id = ?", u.Id).Update("account_id", nil).Error)
	u.AccountId = nil

	// 重试同步：必须复用原账号，而非另建。
	accID2, err := EnsureAccountForUser(u)
	require.NoError(t, err)
	assert.Equal(t, accID, accID2, "重试应复用账号库已有映射的账号，不得另建")

	var accounts, products, phones int64
	accDB.Model(&Account{}).Count(&accounts)
	accDB.Model(&AccountProduct{}).Where("local_user_id = ?", int64(u.Id)).Count(&products)
	accDB.Model(&AccountIdentifier{}).Where("type = ?", IdentifierTypePhone).Count(&phones)
	assert.Equal(t, int64(1), accounts, "不得出现孤儿账号")
	assert.Equal(t, int64(1), products, "一个本地用户只能有一条 parvis 映射")
	assert.Equal(t, int64(1), phones, "phone 标识仍挂在原账号上，唯一")

	// 回填应在重试中补上
	var reloaded User
	require.NoError(t, mainDB.First(&reloaded, "id = ?", u.Id).Error)
	require.NotNil(t, reloaded.AccountId)
	assert.Equal(t, accID, *reloaded.AccountId)
}

func TestMigrateAccountsV0_迁移与幂等(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	require.NoError(t, mainDB.Create(&User{Username: "bob", Password: "hash", Phone: "139", Status: UserStatusEnabled, AccessToken: "tok_bob", AffCode: "aff_bob"}).Error)
	require.NoError(t, mainDB.Create(&User{Username: "carol", WeChatId: "wx_c", Status: UserStatusEnabled, AccessToken: "tok_carol", AffCode: "aff_carol"}).Error)
	// 注销用户不应被迁移
	require.NoError(t, mainDB.Create(&User{Username: "dave", Status: UserStatusDeleted, AccessToken: "tok_dave", AffCode: "aff_dave"}).Error)

	require.NoError(t, MigrateAccountsV0())

	var accounts, products, creds int64
	accDB.Model(&Account{}).Count(&accounts)
	accDB.Model(&AccountProduct{}).Count(&products)
	accDB.Model(&AccountCredential{}).Count(&creds)
	assert.Equal(t, int64(2), accounts, "只迁移 2 个有效用户")
	assert.Equal(t, int64(2), products)
	assert.Equal(t, int64(1), creds, "只有 bob 有密码")

	// users.account_id 应被回写
	var bob User
	require.NoError(t, mainDB.Where("username = ?", "bob").First(&bob).Error)
	require.NotNil(t, bob.AccountId)
	assert.NotZero(t, *bob.AccountId)

	// 注销用户不应有 account_id
	var dave User
	require.NoError(t, mainDB.Where("username = ?", "dave").First(&dave).Error)
	assert.Nil(t, dave.AccountId)

	// 幂等：再跑一次，账号数不变
	require.NoError(t, MigrateAccountsV0())
	accDB.Model(&Account{}).Count(&accounts)
	assert.Equal(t, int64(2), accounts, "重复执行不应新增账号")

	// product 映射指向正确的本地 user id
	var ap AccountProduct
	require.NoError(t, accDB.Where("account_id = ?", *bob.AccountId).First(&ap).Error)
	assert.Equal(t, ProductCodeParvis, ap.ProductCode)
	assert.Equal(t, int64(bob.Id), ap.LocalUserId)
}
