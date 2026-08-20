package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReconcileAccounts_一致与漂移(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)

	// 两个正常投影用户
	u1 := &User{Username: "u1", Phone: "+8613800000001", Status: UserStatusEnabled, AccessToken: "t1", AffCode: "a1"}
	u2 := &User{Username: "u2", WeChatId: "wx2", Status: UserStatusEnabled, AccessToken: "t2", AffCode: "a2"}
	require.NoError(t, mainDB.Create(u1).Error)
	require.NoError(t, mainDB.Create(u2).Error)
	_, err := EnsureAccountForUser(u1)
	require.NoError(t, err)
	id2, err := EnsureAccountForUser(u2)
	require.NoError(t, err)

	// 一个未投影用户（account_id IS NULL）
	u3 := &User{Username: "u3", Status: UserStatusEnabled, AccessToken: "t3", AffCode: "a3"}
	require.NoError(t, mainDB.Create(u3).Error)

	r, err := ReconcileAccounts()
	require.NoError(t, err)
	assert.Equal(t, int64(3), r.TotalUsers)
	assert.Equal(t, int64(2), r.Projected)
	assert.Equal(t, int64(1), r.Unprojected)
	assert.Equal(t, int64(0), r.IdentifierMismatch)
	assert.Equal(t, int64(0), r.MissingAccount)

	// 注入漂移：直接在账号中心把 u2 的微信标识改掉，模拟不一致
	require.NoError(t, accDB.Model(&AccountIdentifier{}).
		Where("account_id = ? AND type = ?", id2, IdentifierTypeWeChat).
		Update("identifier", "wx2_DRIFTED").Error)

	r, err = ReconcileAccounts()
	require.NoError(t, err)
	assert.Equal(t, int64(1), r.IdentifierMismatch, "应检出 u2 标识漂移")
	assert.NotEmpty(t, r.Samples)
}
