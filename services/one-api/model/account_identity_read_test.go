package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// S6 读穿改造回归测试：身份字段(phone/email)展示读以账号中心为准,
// 账号中心未启用/未迁移用户/缺标识时回退 users 值;改手机号后读穿应返回新值。

func TestGetAccountIdentifier_三态(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	u := &User{Username: "ida", Phone: "+8613800001111", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_ida", AffCode: "aff_ida"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 命中
	phone, err := GetAccountIdentifier(accID, IdentifierTypePhone)
	require.NoError(t, err)
	assert.Equal(t, "+8613800001111", phone)

	// 缺失类型(该用户没绑微信)→ ("", nil)
	wx, err := GetAccountIdentifier(accID, IdentifierTypeWeChat)
	require.NoError(t, err)
	assert.Equal(t, "", wx)

	// 账号中心未启用 → ErrAccountCenterDisabled
	orig := ACCOUNT_DB
	ACCOUNT_DB = nil
	_, err = GetAccountIdentifier(accID, IdentifierTypePhone)
	assert.ErrorIs(t, err, ErrAccountCenterDisabled)
	ACCOUNT_DB = orig
}

func TestResolveUserIdentifier_回退语义(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	u := &User{Username: "joe", Phone: "+8613800002222", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_joe", AffCode: "aff_joe"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 命中账号中心
	assert.Equal(t, "+8613800002222", ResolveUserIdentifier(&accID, IdentifierTypePhone, "fallback"))

	// 未迁移用户(account_id nil)→ 回退
	assert.Equal(t, "fallback", ResolveUserIdentifier(nil, IdentifierTypePhone, "fallback"))

	// 账号中心未启用 → 回退
	orig := ACCOUNT_DB
	ACCOUNT_DB = nil
	assert.Equal(t, "fallback", ResolveUserIdentifier(&accID, IdentifierTypePhone, "fallback"))
	ACCOUNT_DB = orig

	// 账号中心缺该标识 → 回退
	assert.Equal(t, "fb_wx", ResolveUserIdentifier(&accID, IdentifierTypeWeChat, "fb_wx"))
}

func TestReadThrough_改手机号后返回新值(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	u := &User{Username: "kim", Phone: "+8613800003333", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_kim", AffCode: "aff_kim"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 走直写函数换号(内部已补双写)
	require.NoError(t, UpdateUserPhone(u.Id, "+8613900003333"))

	got := ResolveUserIdentifier(&accID, IdentifierTypePhone, "")
	assert.Equal(t, "+8613900003333", got, "改手机号后读穿应返回账号中心新值")
}

func TestOverlayUsersIdentity_批量覆盖与回退(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	// migrated:有账号中心标识  unmigrated:account_id 为 nil
	migrated := &User{Username: "lee", Phone: "+8613800004444", Email: "lee@ac.com", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_lee", AffCode: "aff_lee"}
	require.NoError(t, mainDB.Create(migrated).Error)
	_, err := EnsureAccountForUser(migrated)
	require.NoError(t, err)

	unmigrated := &User{Username: "moe", Phone: "+8613800005555", Status: UserStatusEnabled, AccessToken: "tok_moe", AffCode: "aff_moe"}
	require.NoError(t, mainDB.Create(unmigrated).Error)

	// 模拟账号中心被人改了手机号(只动账号中心,不动 users),验证 overlay 取账号中心值
	require.NoError(t, ACCOUNT_DB.Model(&AccountIdentifier{}).
		Where("account_id = ? AND type = ?", *migrated.AccountId, IdentifierTypePhone).
		Update("identifier", "+8613911114444").Error)

	// 阶段 3 起 email 为受管类型(先删后建),账号中心理论上每个 (account_id, email) 只
	// 有一行权威值;此处仍保留这个并发场景断言:即便人为往账号中心插一行陈腐 email,
	// 后续 overlay 应取到的是 EnsureAccountForUser 写入的"权威"值,而非陈腐值。
	// 注意：本测试用 Email 唯一索引 (uk_type_identifier) 保护,陈腐插入会撞键失败,
	// 故此分支等价"不存在多行 email"——保留作为不变量回归。
	require.Error(t, ACCOUNT_DB.Create(&AccountIdentifier{
		AccountId: *migrated.AccountId, Type: IdentifierTypeEmail, Identifier: "lee@ac.com",
	}).Error, "受管类型唯一索引应阻止重复 email 插入")

	users := []*User{migrated, unmigrated}
	OverlayUsersIdentity(users)

	assert.Equal(t, "+8613911114444", migrated.Phone, "已迁移用户 phone 应覆盖为账号中心值")
	assert.Equal(t, "lee@ac.com", migrated.Email, "email 受管后读穿应取到权威值")
	assert.Equal(t, "+8613800005555", unmigrated.Phone, "未迁移用户保留 users 原值")
}
