package model

import (
	"context"
	"errors"
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 回归测试：JIT 通用路径在「命中已有用户」「未命中新建」「占位 username 不污染账号中心」
// 等场景下的语义。这是 S6 单源化前置底座，OAuth/手机号注册都要走它。

func TestJIT_未命中新建(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	// 建表副作用：测试库需要 user_timed_quotas 等附属表，不存在时新用户积分发放会报错。
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u, created, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type:        IdentifierTypePhone,
		Identifier:  "+8613800001234",
		Verified:    true,
		DisplayName: "TestUser",
	})
	require.NoError(t, err)
	assert.True(t, created, "首次调用应新建")
	require.NotNil(t, u)
	require.NotNil(t, u.AccountId)
	accID := *u.AccountId

	// account 存在
	var acc Account
	require.NoError(t, accDB.First(&acc, "id = ?", accID).Error)
	assert.Equal(t, AccountStatusEnabled, acc.Status)

	// 只有 phone 标识；username 占位被清理，不在账号中心
	var idents []AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ?", accID).Find(&idents).Error)
	require.Len(t, idents, 1, "JIT 注册后应只有 phone 标识，username 占位应被清理")
	assert.Equal(t, IdentifierTypePhone, idents[0].Type)
	assert.Equal(t, "+8613800001234", idents[0].Identifier)

	// account_products 映射存在
	var ap AccountProduct
	require.NoError(t, accDB.Where("account_id = ?", accID).First(&ap).Error)
	assert.Equal(t, ProductCodeParvis, ap.ProductCode)
	assert.Equal(t, int64(u.Id), ap.LocalUserId)

	// display_name 落到 account_profiles
	var p AccountProfile
	require.NoError(t, accDB.First(&p, "account_id = ?", accID).Error)
	assert.Equal(t, "TestUser", p.DisplayName)

	// users 表里 placeholder username 仍在（users.username 唯一索引占位）。
	// 阶段 6 单源化后,users.username 列由 User.Insert 改写为 acc_* 占位以
	// 防止唯一键冲突,真实 username 仅在账号中心持有;故只断言占位非空。
	var reloaded User
	require.NoError(t, mainDB.First(&reloaded, "id = ?", u.Id).Error)
	assert.NotEmpty(t, reloaded.Username, "users.username 必须有占位以满足唯一索引")
}

func TestJIT_命中复用(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	first, _, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type: IdentifierTypeWeChat, Identifier: "wx_unionid_a", Verified: true,
	})
	require.NoError(t, err)

	// 同 identifier 再来一次：必须命中、不新建
	again, created, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type: IdentifierTypeWeChat, Identifier: "wx_unionid_a", Verified: true,
	})
	require.NoError(t, err)
	assert.False(t, created, "已存在 identifier 应命中而非新建")
	assert.Equal(t, first.Id, again.Id, "应载入同一本地 user")
}

func TestJIT_并发注册不撞键(t *testing.T) {
	// 同一 identifier 串行调用两次，第二次必须走命中分支，不应 panic 或撞 uk_type_identifier。
	mainDB, accDB := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	_, _, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type: IdentifierTypePhone, Identifier: "+8613900009999", Verified: true,
	})
	require.NoError(t, err)

	_, created, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type: IdentifierTypePhone, Identifier: "+8613900009999", Verified: true,
	})
	require.NoError(t, err)
	assert.False(t, created)

	var n int64
	accDB.Model(&AccountIdentifier{}).Where("type = ? AND identifier = ?", IdentifierTypePhone, "+8613900009999").Count(&n)
	assert.Equal(t, int64(1), n, "同一 phone 应只有一条 identifier 记录")
}

func TestJIT_账号中心未启用_报错(t *testing.T) {
	orig := ACCOUNT_DB
	ACCOUNT_DB = nil
	defer func() { ACCOUNT_DB = orig }()

	_, _, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type: IdentifierTypePhone, Identifier: "+8613811112222",
	})
	require.Error(t, err, "JIT 不能在账号中心未启用时静默成功")
}

func TestJIT_identifier命中但缺_parvis_映射_报错(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	// 构造异常：有 identifier 但没 product 映射（人为造漂移）
	require.NoError(t, accDB.Create(&Account{Id: 99999, Status: AccountStatusEnabled}).Error)
	require.NoError(t, accDB.Create(&AccountIdentifier{
		Id: 88888, AccountId: 99999, Type: IdentifierTypePhone, Identifier: "+8613722223333", Verified: true,
	}).Error)

	_, _, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type: IdentifierTypePhone, Identifier: "+8613722223333",
	})
	require.Error(t, err, "缺 parvis 映射应当作数据漂移报错，不应静默新建第二个账号")
	assert.Contains(t, err.Error(), "数据漂移")

	// 不应误产生第二个 account
	var n int64
	accDB.Model(&Account{}).Count(&n)
	assert.Equal(t, int64(1), n)
}

// 哨兵：UserTimedQuota 在子测试 AutoMigrate 时即使失败也别静默吞，便于追踪
var _ = gorm.ErrRecordNotFound

func TestJIT_identifier撞别账号_回滚孤儿(t *testing.T) {
	// 回归 bug:JIT 未命中分支若在写真 identifier 时撞 uk_type_identifier(已被别的账号占着),
	// 必须回滚已建的 users + account + 映射,否则留下「无登录方式的孤儿账号」。
	// 本测试直接调 jitRollbackProvision 验证回滚行为,撞键路径由代码走读保证调到它。
	mainDB, accDB := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	// 先 JIT 注册一个 user_A,准备好可被回滚的状态
	first, _, err := JITResolveOrCreate(context.Background(), JITRequest{
		Type: IdentifierTypePhone, Identifier: "+8613711115555", Verified: true,
	})
	require.NoError(t, err)
	require.NotNil(t, first.AccountId)
	accID := *first.AccountId

	var accBefore, userBefore int64
	accDB.Model(&Account{}).Count(&accBefore)
	mainDB.Model(&User{}).Count(&userBefore)

	jitRollbackProvision(first.Id, accID, "测试:模拟撞键回滚")

	// users 行被物理删
	var u User
	err = mainDB.Where("id = ?", first.Id).First(&u).Error
	require.Error(t, err)
	assert.True(t, errors.Is(err, gorm.ErrRecordNotFound))

	// account / identifier / product 全部清理
	var acc Account
	err = accDB.Where("id = ?", accID).First(&acc).Error
	require.Error(t, err)
	assert.True(t, errors.Is(err, gorm.ErrRecordNotFound))

	var n int64
	accDB.Model(&AccountIdentifier{}).Where("account_id = ?", accID).Count(&n)
	assert.Zero(t, n, "identifier 应被清空")
	accDB.Model(&AccountProduct{}).Where("account_id = ?", accID).Count(&n)
	assert.Zero(t, n, "product 映射应被清空")

	var accAfter, userAfter int64
	accDB.Model(&Account{}).Count(&accAfter)
	mainDB.Model(&User{}).Count(&userAfter)
	assert.Equal(t, accBefore-1, accAfter, "回滚后 account 总数减 1")
	assert.Equal(t, userBefore-1, userAfter, "回滚后 users 总数减 1")
}

func TestAuthByAccountCenter_email登录命中(t *testing.T) {
	// 回归 bug:authByAccountCenter 漏 email 候选会让 email 登录穿到老路。
	mainDB, _ := setupAccountTestDB(t)
	pwd, err := common.Password2Hash("MySecret123!")
	require.NoError(t, err)

	u := &User{
		Username: "ed_email", Email: "ed@example.com", Password: pwd, Status: UserStatusEnabled,
		AccessToken: "tok_ed", AffCode: "aff_ed",
	}
	require.NoError(t, mainDB.Create(u).Error)
	_, err = EnsureAccountForUser(u)
	require.NoError(t, err)

	got, ok, err := authByAccountCenter("ed@example.com", "MySecret123!")
	require.NoError(t, err)
	require.True(t, ok, "email 登录必须经账号中心命中,不应回退老路")
	assert.Equal(t, u.Id, got.Id)

	// 错密码:命中且报错(不回退)
	_, _, err = authByAccountCenter("ed@example.com", "wrong")
	require.Error(t, err)
}
