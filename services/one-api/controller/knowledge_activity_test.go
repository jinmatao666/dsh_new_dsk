package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestKnowledgeActivityAccessCombinedHistoryAndSearch(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "activity.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeActivity{}, &model.User{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "admin", DisplayName: "管理员", AffCode: "a1", AccessToken: "t1"}).Error)
	require.NoError(t, db.Create(&model.User{Id: 2, Username: "alice", DisplayName: "爱丽丝", AffCode: "a2", AccessToken: "t2"}).Error)
	base := model.KnowledgeBase{Id: 7, Name: "个人资料", OwnerUserId: 2}
	require.NoError(t, model.RecordKnowledgeActivity(db, &base, 2, "create", "personal", "", "", "success"))
	require.NoError(t, model.RecordKnowledgeActivity(db, &base, 1, "transfer", "transferred", "来源资料", "规范.pdf", "success"))
	for _, tc := range []struct {
		role, user, code               int
		tab, keyword, contains, absent string
	}{
		{model.RoleCommonUser, 2, 403, "", "", "", ""},
		{model.RoleRootUser, 1, 400, "invalid", "", "", ""},
		{model.RoleRootUser, 1, 200, "", "", "\"total\":2", ""},
		{model.RoleRootUser, 1, 200, "personal", "", "create", "规范.pdf"},
		{model.RoleRootUser, 1, 200, "transferred", "", "规范.pdf", "\"action\":\"create\""},
		{model.RoleRootUser, 1, 200, "", "规范", "规范.pdf", "\"action\":\"create\""},
		{model.RoleRootUser, 1, 200, "", "来源资料", "transfer", "\"action\":\"create\""},
		{model.RoleRootUser, 1, 200, "", "管理员", "transfer", "\"action\":\"create\""},
		{model.RoleRootUser, 1, 200, "", "alice", "\"total\":2", ""},
		{model.RoleRootUser, 1, 200, "", "不存在", "\"total\":0", "规范.pdf"},
		{model.RoleAdminUser, 9, 200, "", "alice", "\"total\":0", "个人资料"},
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("role", tc.role)
		c.Set("id", tc.user)
		c.Request = httptest.NewRequest("GET", "/?tab="+tc.tab+"&keyword="+url.QueryEscape(tc.keyword), nil)
		ListManagedKnowledgeActivities(c)
		require.Equal(t, tc.code, recorder.Code)
		if tc.contains != "" {
			require.Contains(t, recorder.Body.String(), tc.contains)
		}
		if tc.absent != "" {
			require.NotContains(t, recorder.Body.String(), tc.absent)
		}
	}
}

func TestKnowledgeActivityDocumentDeletionPreservesName(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "delete.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(
		&model.KnowledgeActivity{}, &model.KnowledgeDocumentNote{}, &model.KnowledgeDocumentPath{},
		&model.KnowledgeDocumentCreator{}, &model.KnowledgeDocumentCover{},
	))
	failDelete := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"code":0,"data":{"docs":[{"id":"doc","name":"规范.pdf"}]}}`)
			return
		}
		if failDelete {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = io.WriteString(w, `{"message":"unavailable"}`)
			return
		}
		_, _ = io.WriteString(w, `{"code":0,"data":null}`)
	}))
	defer server.Close()
	t.Setenv("RAGFLOW_BASE_URL", server.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")
	base := model.KnowledgeBase{Id: 7, Name: "个人资料", OwnerUserId: 2, RagflowDatasetId: "dataset"}
	for _, code := range []int{http.StatusBadGateway, http.StatusOK} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", 1)
		c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
		deleteKnowledgeDocumentWithActivity(c, &base, "doc")
		require.Equal(t, code, recorder.Code, recorder.Body.String())
		var rows []model.KnowledgeActivity
		require.NoError(t, db.Find(&rows).Error)
		if failDelete {
			require.Empty(t, rows)
		} else {
			require.Len(t, rows, 1)
			require.Equal(t, "delete_document", rows[0].Action)
			require.Equal(t, "规范.pdf", rows[0].DocumentName)
			require.Equal(t, 1, rows[0].ActorId)
		}
		failDelete = false
	}
}
