package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/songquanpeng/one-api/common"
)

func TestValidateAndFill_账号中心命中(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	hash, err := common.Password2Hash("secret123")
	require.NoError(t, err)
	u := &User{Username: "alice", Password: hash, Phone: "+8613800000000", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_a", AffCode: "aff_a"}
	require.NoError(t, mainDB.Create(u).Error)
	_, err = EnsureAccountForUser(u)
	require.NoError(t, err)

	// 用户名登录
	login := &User{Username: "alice", Password: "secret123"}
	require.NoError(t, login.ValidateAndFill())
	assert.Equal(t, u.Id, login.Id)

	// 手机号登录（同一套密码）
	byPhone := &User{Username: "+8613800000000", Password: "secret123"}
	require.NoError(t, byPhone.ValidateAndFill())
	assert.Equal(t, u.Id, byPhone.Id)

	// 密码错：账号中心命中，直接失败，不回退
	bad := &User{Username: "alice", Password: "wrong"}
	assert.Error(t, bad.ValidateAndFill())
}

func TestValidateAndFill_未迁移用户账号中心启用直接失败(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	// 阶段 2 单源化收紧 ValidateAndFill：账号中心启用后，密码已是「账号中心唯一权威写入源」，
	// users.password 列停写。若账号中心查不到该 username，必须直接返回认证错误，绝不回退老路
	// （回退到 users 老路会读到陈腐 password 值，是单源化要根除的漂移源）。
	hash, err := common.Password2Hash("legacy123")
	require.NoError(t, err)
	// 不调用 EnsureAccountForUser，模拟尚未迁移的历史用户
	u := &User{Username: "bob", Password: hash, Status: UserStatusEnabled, AccessToken: "tok_b", AffCode: "aff_b"}
	require.NoError(t, mainDB.Create(u).Error)

	login := &User{Username: "bob", Password: "legacy123"}
	assert.Error(t, login.ValidateAndFill(), "账号中心启用后未投影用户必须直接失败,不回退老路")
}
