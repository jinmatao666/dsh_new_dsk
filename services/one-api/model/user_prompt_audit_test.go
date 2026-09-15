package model

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

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
