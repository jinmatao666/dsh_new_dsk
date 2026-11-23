package model

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSQLiteTokenQuotaDebitRefundAndBatchDelta(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "token.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	previousDB, previousSQLite, previousBatch := DB, common.UsingSQLite, config.BatchUpdateEnabled
	DB, common.UsingSQLite, config.BatchUpdateEnabled = db, true, false
	t.Cleanup(func() {
		DB, common.UsingSQLite, config.BatchUpdateEnabled = previousDB, previousSQLite, previousBatch
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&Token{}, &User{}, &UserTimedQuota{}))
	require.NoError(t, db.Create(&Token{Id: 1, UserId: 1, Key: "test", RemainQuota: 100}).Error)
	require.NoError(t, DecreaseTokenQuota(1, 30))
	assertTokenQuota := func(remaining, used int64) {
		t.Helper()
		var token Token
		require.NoError(t, db.First(&token, 1).Error)
		require.Equal(t, remaining, token.RemainQuota)
		require.Equal(t, used, token.UsedQuota)
	}
	assertTokenQuota(70, 30)
	require.NoError(t, IncreaseTokenQuota(1, 10))
	assertTokenQuota(80, 20)
	require.NoError(t, increaseTokenQuota(1, -90))
	assertTokenQuota(0, 110)
	require.NoError(t, IncreaseTokenQuota(1, 25))
	assertTokenQuota(25, 85)
	require.NoError(t, DecreaseTokenQuota(1, 30))
	assertTokenQuota(0, 115)
	require.Error(t, DecreaseTokenQuota(1, -1))
	require.Error(t, IncreaseTokenQuota(1, -1))
	assertTokenQuota(0, 115)
	// An account debit failure must not be hidden by a successful token update.
	require.NoError(t, IncreaseTokenQuota(1, 100))
	require.Error(t, PostConsumeTokenQuota(1, 10))
	assertTokenQuota(100, 15)
}
