package model

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func forumBillingDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "forum.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	oldDB, oldSQLite, oldRedis, oldUnit := DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit
	DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit = db, true, false, 1000
	config.OptionMapRWMutex.Lock()
	oldMap := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"edition":"operations","billing":{"enabled":true}}`}
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit = oldDB, oldSQLite, oldRedis, oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldMap
		config.OptionMapRWMutex.Unlock()
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&User{}, &UserTimedQuota{}, &BillingRule{}, &BillingTask{}, &ForumAnalysis{}))
	for id, name := range []string{"payer", "other"} {
		require.NoError(t, db.Create(&User{Id: id + 1, Username: name, AffCode: name, AccessToken: name, Quota: 10000, TimedQuotaTotal: 10000}).Error)
		require.NoError(t, db.Create(&UserTimedQuota{UserId: id + 1, Amount: 10000, Remaining: 10000, Source: TimedQuotaSourceAdmin}).Error)
	}
	return db
}

func TestForumAnalysisChargesOnceAndReusesAnswerAcrossSessions(t *testing.T) {
	db := forumBillingDB(t)
	rules, err := EnsureForumRules(db)
	require.NoError(t, err)
	require.Len(t, rules, 2)
	for _, rule := range rules {
		require.Equal(t, int64(1000), rule.UnitQuota)
	}
	key, err := ForumQuestionKey("article", "a1", " 核心\n 要点是什么 ", "qa")
	require.NoError(t, err)
	same, _ := ForumQuestionKey("article", "a1", "核心 要点是什么", "qa")
	require.Equal(t, key, same)
	row, lease, err := BeginForumAnalysis(1, key, "qa", "desktop-session-1", "chosen-model", 1)
	require.NoError(t, err)
	require.Len(t, lease, 72)
	_, _, err = BeginForumAnalysis(1, key, "qa", "desktop-session-concurrent", "different-model", 1)
	require.EqualError(t, err, "ANALYSIS_PENDING")
	_, err = ClaimForumModelCall(1, "desktop-session-1", "wrong-model")
	require.Error(t, err)
	claim, err := ClaimForumModelCall(1, "desktop-session-1", "chosen-model")
	require.NoError(t, err)
	require.Equal(t, row.ID, claim)
	_, err = ClaimForumModelCall(1, "desktop-session-1", "chosen-model")
	require.Error(t, err)
	claim, err = ClaimForumModelCall(2, "desktop-session-1", "chosen-model")
	require.NoError(t, err)
	require.Empty(t, claim)
	_, err = FinishForumAnalysis(2, row.ID, lease, "succeeded", "不能窃取", "server", "chosen-model")
	require.Error(t, err)
	_, err = FinishForumAnalysis(1, row.ID, "wrong", "succeeded", "不能伪造", "server", "chosen-model")
	require.Error(t, err)
	result, err := FinishForumAnalysis(1, row.ID, lease, "succeeded", "原答案", "server", "chosen-model")
	require.NoError(t, err)
	again, err := FinishForumAnalysis(1, row.ID, lease, "succeeded", "覆盖答案", "other", "other")
	require.NoError(t, err)
	require.Equal(t, result.Text, again.Text)
	cached, nextLease, err := BeginForumAnalysis(1, key, "qa", "new-desktop-after-refresh", "new-model", 99)
	require.NoError(t, err)
	require.Empty(t, nextLease)
	require.Equal(t, "原答案", cached.Text)
	var user User
	require.NoError(t, db.First(&user, 1).Error)
	require.Equal(t, int64(9000), user.Quota)
	require.Equal(t, int64(1000), user.UsedQuota)
	var tasks int64
	require.NoError(t, db.Model(&BillingTask{}).Count(&tasks).Error)
	require.Equal(t, int64(1), tasks)
	_, _, err = BeginForumAnalysis(2, key, "qa", "other-user-session", "chosen-model", 1)
	require.NoError(t, err)
	reportKey, _ := ForumQuestionKey("article", "a1", "核心 要点是什么", "report")
	require.NotEqual(t, key, reportKey)
	require.NoError(t, db.Model(&BillingRule{}).Where("action = ?", "report").Updates(map[string]interface{}{"unit_quota": 3000, "version": 2}).Error)
	_, _, err = BeginForumAnalysis(1, reportKey, "report", "report-price-changed", "chosen-model", 1)
	require.EqualError(t, err, "PRICE_CHANGED")
	reportRow, _, err := BeginForumAnalysis(1, reportKey, "report", "report-price-accepted", "chosen-model", 2)
	require.NoError(t, err)
	var task BillingTask
	require.NoError(t, db.First(&task, "id = ?", reportRow.TaskID).Error)
	require.Equal(t, int64(3000), task.Quota)
}

func TestForumAnalysisRefundsFailureCancellationAndExpiry(t *testing.T) {
	db := forumBillingDB(t)
	_, err := EnsureForumRules(db)
	require.NoError(t, err)
	for _, status := range []string{"failed", "cancelled"} {
		key, _ := ForumQuestionKey("report", status, "请分析", "qa")
		row, lease, err := BeginForumAnalysis(1, key, "qa", "session-"+status, "model", 1)
		require.NoError(t, err)
		_, err = FinishForumAnalysis(1, row.ID, lease, status, "", "", "")
		require.NoError(t, err)
		retry, retryLease, err := BeginForumAnalysis(1, key, "qa", "retry-"+status, "model", 1)
		require.NoError(t, err)
		require.Equal(t, row.ID, retry.ID)
		require.NotEqual(t, lease, retryLease)
		_, err = FinishForumAnalysis(1, retry.ID, retryLease, "cancelled", "", "", "")
		require.NoError(t, err)
	}
	key, _ := ForumQuestionKey("article", "expired", "分析", "qa")
	row, _, err := BeginForumAnalysis(1, key, "qa", "expired-session", "model", 1)
	require.NoError(t, err)
	before := time.Now().Add(-time.Minute)
	require.NoError(t, db.Model(&ForumAnalysis{}).Where("id = ?", row.ID).Update("expires_at", before).Error)
	require.NoError(t, db.Model(&BillingTask{}).Where("id = ?", row.TaskID).Update("expires_at", before).Error)
	retry, lease, err := BeginForumAnalysis(1, key, "qa", "expired-retry-session", "model", 1)
	require.NoError(t, err)
	_, err = FinishForumAnalysis(1, retry.ID, lease, "cancelled", "", "", "")
	require.NoError(t, err)
	var user User
	require.NoError(t, db.First(&user, 1).Error)
	require.Equal(t, int64(10000), user.Quota)
	require.Zero(t, user.UsedQuota)
	key, _ = ForumQuestionKey("article", "too-poor", "分析", "report")
	require.NoError(t, db.Model(&BillingRule{}).Where("action = ?", "report").Updates(map[string]interface{}{"unit_quota": 11000}).Error)
	_, _, err = BeginForumAnalysis(1, key, "report", "not-enough-credits", "model", 1)
	require.EqualError(t, err, "INSUFFICIENT_CREDITS")
	var count int64
	require.NoError(t, db.Model(&ForumAnalysis{}).Where("question_key = ?", key).Count(&count).Error)
	require.Zero(t, count)
}

func TestForumFreePriceAndDisabledBillingStillReuseAnswers(t *testing.T) {
	db := forumBillingDB(t)
	_, err := EnsureForumRules(db)
	require.NoError(t, err)
	require.NoError(t, db.Model(&BillingRule{}).Where("action = ?", "qa").Update("unit_quota", 0).Error)
	for _, disabled := range []bool{false, true} {
		question := "免费问题"
		if disabled {
			config.OptionMapRWMutex.Lock()
			config.OptionMap["SystemDeploymentSettings"] = `{"edition":"government","billing":{"enabled":false}}`
			config.OptionMapRWMutex.Unlock()
			question = "关闭积分问题"
		}
		key, _ := ForumQuestionKey("article", "free", question, "qa")
		row, lease, err := BeginForumAnalysis(1, key, "qa", "session-"+key[:16], "model", 1)
		require.NoError(t, err)
		_, err = FinishForumAnalysis(1, row.ID, lease, "succeeded", "免费答案", "server", "model")
		require.NoError(t, err)
		cached, _, err := BeginForumAnalysis(1, key, "qa", "refresh-"+key[:16], "model", 1)
		require.NoError(t, err)
		require.Equal(t, "免费答案", cached.Text)
		if disabled {
			require.Empty(t, row.TaskID)
		}
	}
	var user User
	require.NoError(t, db.First(&user, 1).Error)
	require.Equal(t, int64(10000), user.Quota)
	require.Zero(t, user.UsedQuota)
}
