package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccountProfile_读穿与写收口(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	u := &User{Username: "alice", DisplayName: "Alice", Status: UserStatusEnabled, AccessToken: "tok_a", AffCode: "aff_a"}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 投影应把 display_name 播种进全局档案
	p, err := GetAccountProfile(accID)
	require.NoError(t, err)
	require.NotNil(t, p)
	assert.Equal(t, "Alice", p.DisplayName)

	// 写收口：通过账号中心改昵称+头像
	require.NoError(t, UpdateAccountProfile(accID, "Alice New", "https://cdn/a.png"))
	p, err = GetAccountProfile(accID)
	require.NoError(t, err)
	assert.Equal(t, "Alice New", p.DisplayName)
	assert.Equal(t, "https://cdn/a.png", p.AvatarURL)

	// 空字符串表示不修改：只改头像，昵称保留
	require.NoError(t, UpdateAccountProfile(accID, "", "https://cdn/b.png"))
	p, err = GetAccountProfile(accID)
	require.NoError(t, err)
	assert.Equal(t, "Alice New", p.DisplayName, "空 display_name 不应清空昵称")
	assert.Equal(t, "https://cdn/b.png", p.AvatarURL)

	// 账号中心改过昵称后，再次双写不应被 users 旧值回冲
	u.DisplayName = "StaleFromUsers"
	_, err = EnsureAccountForUser(u)
	require.NoError(t, err)
	p, err = GetAccountProfile(accID)
	require.NoError(t, err)
	assert.Equal(t, "Alice New", p.DisplayName, "账号中心应是档案唯一写入源,不被 users 回冲")
}

func TestAccountProfile_批量读穿(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)

	u1 := &User{Username: "u1", DisplayName: "U1", Status: UserStatusEnabled, AccessToken: "t1", AffCode: "a1"}
	u2 := &User{Username: "u2", DisplayName: "U2", Status: UserStatusEnabled, AccessToken: "t2", AffCode: "a2"}
	require.NoError(t, mainDB.Create(u1).Error)
	require.NoError(t, mainDB.Create(u2).Error)
	id1, _ := EnsureAccountForUser(u1)
	id2, _ := EnsureAccountForUser(u2)

	m, err := GetAccountProfiles([]int64{id1, id2, 99999})
	require.NoError(t, err)
	assert.Len(t, m, 2, "不存在的 account_id 不应出现在结果中")
	assert.Equal(t, "U1", m[id1].DisplayName)
	assert.Equal(t, "U2", m[id2].DisplayName)
}
