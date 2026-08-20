package model

import (
	"testing"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupLogTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&Log{}))
	LOG_DB = db
	common.UsingSQLite = true
}

func TestSearchLogsByUsernameDayAndModel(t *testing.T) {
	setupLogTestDB(t)
	now := time.Now().Unix()
	seed := []*Log{
		{UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeConsume,
			CreatedAt: now - 3600, PromptTokens: 100, CompletionTokens: 50, Quota: 10},
		{UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeConsume,
			CreatedAt: now - 3600, PromptTokens: 200, CompletionTokens: 80, Quota: 20},
		{UserId: 2, Username: "bob", ModelName: "gpt-4", Type: LogTypeConsume,
			CreatedAt: now - 3600, PromptTokens: 999, CompletionTokens: 999, Quota: 99},
		{UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeTopup,
			CreatedAt: now - 3600, PromptTokens: 0, CompletionTokens: 0, Quota: 500},
	}
	for _, l := range seed {
		assert.NoError(t, LOG_DB.Create(l).Error)
	}
	got, err := SearchLogsByUsernameDayAndModel("alice", int(now-7200), int(now+60))
	assert.NoError(t, err)
	assert.Len(t, got, 1)
	assert.Equal(t, "gpt-4", got[0].ModelName)
	assert.Equal(t, 2, got[0].RequestCount)
	assert.Equal(t, 300, got[0].PromptTokens)
	assert.Equal(t, 130, got[0].CompletionTokens)
	assert.Equal(t, 30, got[0].Quota)
}

func seedRankingLogs(t *testing.T) int64 {
	setupLogTestDB(t)
	now := time.Now().Unix()
	seed := []*Log{
		{UserId: 1, Username: "alice", Type: LogTypeConsume, CreatedAt: now - 3600,
			PromptTokens: 100, CompletionTokens: 50, Quota: 10},
		{UserId: 1, Username: "alice", Type: LogTypeConsume, CreatedAt: now - 3600,
			PromptTokens: 100, CompletionTokens: 50, Quota: 10},
		{UserId: 2, Username: "bob", Type: LogTypeConsume, CreatedAt: now - 3600,
			PromptTokens: 500, CompletionTokens: 500, Quota: 5},
		{UserId: 3, Username: "carol", Type: LogTypeConsume, CreatedAt: now - 3600,
			PromptTokens: 10, CompletionTokens: 10, Quota: 100},
		{UserId: 4, Username: "dave", Type: LogTypeConsume, CreatedAt: now - 86400*40,
			PromptTokens: 99999, CompletionTokens: 99999, Quota: 99999},
		{UserId: 5, Username: "eve", Type: LogTypeTopup, CreatedAt: now - 3600,
			PromptTokens: 99999, CompletionTokens: 99999, Quota: 99999},
	}
	for _, l := range seed {
		assert.NoError(t, LOG_DB.Create(l).Error)
	}
	return now
}

func TestGetUserUsageRanking_SortTokens(t *testing.T) {
	now := seedRankingLogs(t)
	got, err := GetUserUsageRanking(now-7200, now+60, "tokens", 10)
	assert.NoError(t, err)
	assert.Len(t, got, 3)
	assert.Equal(t, "bob", got[0].Username)
	assert.Equal(t, int64(1000), got[0].Tokens)
	assert.Equal(t, "alice", got[1].Username)
	assert.Equal(t, "carol", got[2].Username)
}

func TestGetUserUsageRanking_SortQuota(t *testing.T) {
	now := seedRankingLogs(t)
	got, err := GetUserUsageRanking(now-7200, now+60, "quota", 10)
	assert.NoError(t, err)
	assert.Equal(t, "carol", got[0].Username)
	assert.Equal(t, int64(100), got[0].Quota)
}

func TestGetUserUsageRanking_SortCount(t *testing.T) {
	now := seedRankingLogs(t)
	got, err := GetUserUsageRanking(now-7200, now+60, "count", 10)
	assert.NoError(t, err)
	assert.Equal(t, "alice", got[0].Username)
	assert.Equal(t, int64(2), got[0].RequestCount)
}

func TestGetUserUsageRanking_LimitRespected(t *testing.T) {
	now := seedRankingLogs(t)
	got, err := GetUserUsageRanking(now-7200, now+60, "tokens", 2)
	assert.NoError(t, err)
	assert.Len(t, got, 2)
}

func TestGetUserUsageRanking_TimeRangeExcludesOldAndTopups(t *testing.T) {
	now := seedRankingLogs(t)
	got, err := GetUserUsageRanking(now-7200, now+60, "tokens", 10)
	assert.NoError(t, err)
	for _, r := range got {
		assert.NotEqual(t, "dave", r.Username)
		assert.NotEqual(t, "eve", r.Username)
	}
}

func TestGetUserUsageRanking_IllegalSortFallsBackToTokens(t *testing.T) {
	now := seedRankingLogs(t)
	got, err := GetUserUsageRanking(now-7200, now+60, "drop_table", 10)
	assert.NoError(t, err)
	assert.Equal(t, "bob", got[0].Username)
}

// seedOrgUsageLogs 造一个企业(org_id=1)的混合日志:计费成功 + 错误请求 + 充值.
// 错误请求带 org_id 但 quota=0(见 relay/controller/error_log.go),用于验证用量聚合
// 是否正确排除了非计费日志。
func seedOrgUsageLogs(t *testing.T) {
	setupLogTestDB(t)
	now := time.Now().Unix()
	seed := []*Log{
		// alice:2 条计费成功
		{OrgId: 1, UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeConsume,
			CreatedAt: now - 3600, PromptTokens: 100, CompletionTokens: 50, Quota: 10},
		{OrgId: 1, UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeConsume,
			CreatedAt: now - 3600, PromptTokens: 200, CompletionTokens: 80, Quota: 20},
		// alice:3 条错误请求(quota=0),不应计入请求数/消耗
		{OrgId: 1, UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeError,
			CreatedAt: now - 3600, PromptTokens: 0, CompletionTokens: 0, Quota: 0},
		{OrgId: 1, UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeError,
			CreatedAt: now - 3600, PromptTokens: 0, CompletionTokens: 0, Quota: 0},
		{OrgId: 1, UserId: 1, Username: "alice", ModelName: "gpt-4", Type: LogTypeError,
			CreatedAt: now - 3600, PromptTokens: 0, CompletionTokens: 0, Quota: 0},
		// bob:1 条计费成功
		{OrgId: 1, UserId: 2, Username: "bob", ModelName: "claude-3", Type: LogTypeConsume,
			CreatedAt: now - 3600, PromptTokens: 500, CompletionTokens: 500, Quota: 99},
		// 充值日志(quota 很大),不应计入用量
		{OrgId: 1, UserId: 2, Username: "bob", Type: LogTypeTopup,
			CreatedAt: now - 3600, Quota: 99999},
		// 其他企业的日志,不应串味
		{OrgId: 2, UserId: 9, Username: "other", ModelName: "gpt-4", Type: LogTypeConsume,
			CreatedAt: now - 3600, PromptTokens: 1, CompletionTokens: 1, Quota: 1},
	}
	for _, l := range seed {
		assert.NoError(t, LOG_DB.Create(l).Error)
	}
}

func TestGetOrgUsageByMember_ExcludesErrorAndTopup(t *testing.T) {
	seedOrgUsageLogs(t)
	rows, err := GetOrgUsageByMember(1, OrgLogFilter{})
	assert.NoError(t, err)
	assert.Len(t, rows, 2) // alice + bob,不含其他企业

	byUser := make(map[int]*OrgMemberUsage, len(rows))
	for _, r := range rows {
		byUser[r.UserId] = r
	}
	// alice:仅 2 条计费,error 请求不计入请求数,消耗只累加计费行
	assert.Equal(t, int64(2), byUser[1].RequestCount)
	assert.Equal(t, int64(300), byUser[1].PromptTokens)
	assert.Equal(t, int64(130), byUser[1].CompletionTokens)
	assert.Equal(t, int64(30), byUser[1].Quota)
	// bob:1 条计费,topup 不计入
	assert.Equal(t, int64(1), byUser[2].RequestCount)
	assert.Equal(t, int64(99), byUser[2].Quota)
}

func TestGetOrgUsageByModel_ExcludesErrorAndTopup(t *testing.T) {
	seedOrgUsageLogs(t)
	rows, err := GetOrgUsageByModel(1, OrgLogFilter{})
	assert.NoError(t, err)

	byModel := make(map[string]*OrgModelUsage, len(rows))
	for _, r := range rows {
		byModel[r.ModelName] = r
	}
	// gpt-4:alice 的 2 条计费(3 条 error 被排除)
	assert.Equal(t, int64(2), byModel["gpt-4"].RequestCount)
	assert.Equal(t, int64(30), byModel["gpt-4"].Quota)
	// claude-3:bob 的 1 条计费
	assert.Equal(t, int64(1), byModel["claude-3"].RequestCount)
	assert.Equal(t, int64(99), byModel["claude-3"].Quota)
}

func TestGetOrgLogsStat_ExcludesErrorAndTopup(t *testing.T) {
	seedOrgUsageLogs(t)
	stat, err := GetOrgLogsStat(1, OrgLogFilter{})
	assert.NoError(t, err)
	// 仅 3 条计费日志(alice 2 + bob 1),error/topup/其他企业都排除
	assert.Equal(t, int64(3), stat["total_count"])
	// 总消耗 = 10 + 20 + 99 = 129
	assert.Equal(t, int64(129), stat["total_quota"])
}
