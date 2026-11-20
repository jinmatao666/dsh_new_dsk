package model

import (
	"errors"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
)

func TestKnowledgeActivityRetainsNamesAndRollsBackWithTransaction(t *testing.T) {
	base, _, _ := publicationFixture(t)
	stopped := errors.New("abort")
	err := DB.Transaction(func(tx *gorm.DB) error {
		require.NoError(t, RecordKnowledgeActivity(tx, &base, 7, "create", "personal", "", "", "success"))
		return stopped
	})
	require.ErrorIs(t, err, stopped)
	var count int64
	require.NoError(t, DB.Model(&KnowledgeActivity{}).Count(&count).Error)
	require.Zero(t, count)
	app, err := ApplyKnowledgePublication(7, base.Id, "public", "")
	require.NoError(t, err)
	_, err = ReviewKnowledgePublication(app.Id, 1, true, "")
	require.NoError(t, err)
	_, err = ReviewKnowledgePublication(app.Id, 1, true, "")
	require.Error(t, err)
	require.NoError(t, DB.Model(&base).Update("name", "新名称").Error)
	var rows []KnowledgeActivity
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	require.Equal(t, "个人资料", rows[0].KnowledgeBaseName)
	require.Equal(t, "publish_public", rows[0].Action)
	require.Equal(t, KnowledgeSubscriptionApproved, rows[0].Status)
	require.Equal(t, 1, rows[0].ActorId)
	require.False(t, rows[0].CreatedAt.IsZero())
}

func TestKnowledgeActivitySurvivesLibraryAndCategoryDeletion(t *testing.T) {
	base, category, _ := publicationFixture(t)
	require.NoError(t, DB.AutoMigrate(
		&KnowledgeConversation{}, &KnowledgeDocumentNote{}, &KnowledgeDocumentPath{},
		&KnowledgeDocumentCreator{}, &KnowledgeFolder{}, &KnowledgeDocumentCover{},
	))
	require.NoError(t, RecordKnowledgeActivity(DB, &base, 7, "create", "personal", "", "", "success"))
	require.NoError(t, DeleteKnowledgeBaseWithActivity(&base, 1))
	var count int64
	require.NoError(t, DB.Model(&KnowledgeBase{}).Where("id = ?", base.Id).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, DeleteKnowledgeCategoryWithActivity(&category, 1))
	var rows []KnowledgeActivity
	require.NoError(t, DB.Order("id").Find(&rows).Error)
	require.Len(t, rows, 3)
	require.Equal(t, "create", rows[0].Action)
	require.Equal(t, "delete_base", rows[1].Action)
	require.Equal(t, base.Name, rows[1].KnowledgeBaseName)
	require.Equal(t, "delete_category", rows[2].Action)
	require.Equal(t, category.Name, rows[2].KnowledgeBaseName)
}
