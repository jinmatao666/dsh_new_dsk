package model

import (
	"context"
	"fmt"
	"testing"

	"github.com/songquanpeng/one-api/common/helper"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func promptAuditContext(requestID string) context.Context {
	return helper.SetRequestID(context.Background(), requestID)
}

func TestIsUserPromptAuditQuestionFiltersFrameworkPrompts(t *testing.T) {
	for _, question := range append([]string{""}, userPromptAuditIgnoredPrefixes...) {
		if IsUserPromptAuditQuestion(question) {
			t.Fatalf("framework prompt was accepted: %q", question)
		}
	}
	if !IsUserPromptAuditQuestion("请对这份数据进行分析") {
		t.Fatal("user question was rejected")
	}
}

func TestGetUserPromptAuditsPaginatesFilteredRows(t *testing.T) {
	previousDB := DB
	t.Cleanup(func() { DB = previousDB })
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&UserPromptAudit{}))
	DB = db

	for index := 0; index < 55; index++ {
		require.NoError(t, DB.Create(&UserPromptAudit{
			CreatedAt: int64(index + 1),
			Question:  fmt.Sprintf("用户问题 %02d", index),
			Username:  "tester",
		}).Error)
	}
	require.NoError(t, DB.Create(&UserPromptAudit{CreatedAt: 100, Question: "<system-reminder>internal</system-reminder>"}).Error)

	first, total, err := GetUserPromptAudits("", 0, 50)
	require.NoError(t, err)
	require.Equal(t, int64(55), total)
	require.Len(t, first, 50)

	second, secondTotal, err := GetUserPromptAudits("", 50, 50)
	require.NoError(t, err)
	require.Equal(t, total, secondTotal)
	require.Len(t, second, 5)
	require.NotEqual(t, first[len(first)-1].Id, second[0].Id)
}

func TestUserPromptAuditAggregatesOneDesktopTurn(t *testing.T) {
	previousDB := DB
	t.Cleanup(func() { DB = previousDB })
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&UserPromptAudit{}))
	DB = db

	StartUserPromptAudit(promptAuditContext("request-1"), 7, 1, "model-a", "session-a", 2, "分析这份材料")
	FinishUserPromptAudit(promptAuditContext("request-1"), "success", "", 10, 20, 30, 40)
	StartUserPromptAudit(promptAuditContext("request-2"), 7, 2, "model-a", "session-a", 2, "分析这份材料")
	FinishUserPromptAudit(promptAuditContext("request-2"), "success", "", 11, 21, 31, 41)

	var audits []UserPromptAudit
	require.NoError(t, DB.Find(&audits).Error)
	require.Len(t, audits, 1)
	require.Equal(t, "request-2", audits[0].RequestId)
	require.Equal(t, 21, audits[0].Quota)
	require.Equal(t, 41, audits[0].PromptTokens)
	require.Equal(t, 61, audits[0].CompletionTokens)
	require.Equal(t, int64(81), audits[0].ElapsedTime)
}

func TestUserPromptAuditKeepsRepeatedTextInSeparateTurns(t *testing.T) {
	previousDB := DB
	t.Cleanup(func() { DB = previousDB })
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&UserPromptAudit{}))
	DB = db

	StartUserPromptAudit(promptAuditContext("request-1"), 7, 1, "model-a", "session-a", 1, "继续")
	StartUserPromptAudit(promptAuditContext("request-2"), 7, 1, "model-a", "session-a", 2, "继续")

	var count int64
	require.NoError(t, DB.Model(&UserPromptAudit{}).Count(&count).Error)
	require.Equal(t, int64(2), count)
}
