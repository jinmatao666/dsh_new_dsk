package controller

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	dbmodel "github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSQLiteLegacyBillingSettlesAccountTokenAndLog(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "billing.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	oldDB, oldLog, oldSQLite, oldRedis, oldBatch := dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled, config.BatchUpdateEnabled
	dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled, config.BatchUpdateEnabled = db, db, true, false, false
	t.Cleanup(func() {
		dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled, config.BatchUpdateEnabled = oldDB, oldLog, oldSQLite, oldRedis, oldBatch
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&dbmodel.User{}, &dbmodel.UserTimedQuota{}, &dbmodel.Token{}, &dbmodel.Log{}, &dbmodel.Channel{}))
	require.NoError(t, db.Create(&dbmodel.User{Id: 1, Username: "sqlite-billing", Quota: 1000000, TimedQuotaTotal: 1000000}).Error)
	require.NoError(t, db.Create(&dbmodel.UserTimedQuota{UserId: 1, Amount: 1000000, Remaining: 1000000, Source: dbmodel.TimedQuotaSourceAdmin}).Error)
	require.NoError(t, db.Create(&dbmodel.Token{Id: 1, UserId: 1, Key: "test", RemainQuota: 1000000}).Error)
	m := &meta.Meta{UserId: 1, TokenId: 1, ChannelId: 1, StartTime: time.Now()}
	request := &model.GeneralOpenAIRequest{Model: "sqlite-billing-test"}
	postConsumeQuota(context.Background(), &model.Usage{PromptTokens: 100, CompletionTokens: 50}, m, request, 1, 0, 1, 1, false)
	var user dbmodel.User
	var token dbmodel.Token
	var log dbmodel.Log
	require.NoError(t, db.First(&user, 1).Error)
	require.NoError(t, db.First(&token, 1).Error)
	require.NoError(t, db.First(&log).Error)
	require.Positive(t, log.Quota)
	require.Equal(t, int64(log.Quota), 1000000-user.Quota)
	require.Equal(t, int64(log.Quota), 1000000-token.RemainQuota)
	require.Equal(t, int64(log.Quota), token.UsedQuota)
	require.Equal(t, int64(log.Quota), user.UsedQuota)
	require.NoError(t, dbmodel.PostConsumeTokenQuota(1, -int64(log.Quota)))
	require.NoError(t, db.First(&user, 1).Error)
	require.NoError(t, db.First(&token, 1).Error)
	require.Equal(t, int64(1000000), user.Quota)
	require.Equal(t, int64(1000000), token.RemainQuota)
	require.Zero(t, token.UsedQuota)
}

func TestForumModelUsageDoesNotDebitAccountOrTokenAgain(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "forum-usage.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	oldDB, oldLog, oldSQLite, oldRedis := dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled
	dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled = db, db, true, false
	t.Cleanup(func() {
		dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled = oldDB, oldLog, oldSQLite, oldRedis
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&dbmodel.User{}, &dbmodel.Token{}, &dbmodel.Log{}, &dbmodel.Channel{}))
	// The configured business reservation may have consumed the last available point.
	require.NoError(t, db.Create(&dbmodel.User{Id: 1, Username: "forum-last-point", Quota: 0}).Error)
	require.NoError(t, db.Create(&dbmodel.Token{Id: 1, UserId: 1, Key: "forum", RemainQuota: 1000}).Error)
	m := &meta.Meta{UserId: 1, TokenId: 1, ChannelId: 1, StartTime: time.Now(), ForumAnalysisID: "paid-operation", CreditSessionID: "forum-session"}
	request := &model.GeneralOpenAIRequest{Model: "chosen-model", MaxTokens: 4096}
	quota, failure := preConsumeQuota(context.Background(), request, 500, 1, m)
	require.Nil(t, failure)
	require.Zero(t, quota)
	postConsumeQuota(context.Background(), &model.Usage{PromptTokens: 500, CompletionTokens: 100}, m, request, 1, 0, 1, 1, false)
	var user dbmodel.User
	var token dbmodel.Token
	var log dbmodel.Log
	require.NoError(t, db.First(&user, 1).Error)
	require.NoError(t, db.First(&token, 1).Error)
	require.NoError(t, db.First(&log).Error)
	require.Zero(t, user.Quota)
	require.Zero(t, user.UsedQuota)
	require.Equal(t, int64(1000), token.RemainQuota)
	require.Zero(t, token.UsedQuota)
	require.Zero(t, log.Quota)
	require.Equal(t, 500, log.PromptTokens)
	require.Contains(t, log.Content, "paid-operation")
}
