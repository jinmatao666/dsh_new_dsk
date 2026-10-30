package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestParseKnowledgePersonalQuotaDefaultsAndEnabled(t *testing.T) {
	got, err := parseKnowledgePersonalQuota(nil)
	require.NoError(t, err)
	require.False(t, got.Enabled)
	require.Equal(t, int64(0), got.TotalBytes)
	require.Empty(t, got.Allocations)

	got, err = parseKnowledgePersonalQuota(json.RawMessage(`{"enabled":true,"totalBytes":104857600,"allocations":[{"userId":8,"quotaBytes":10485760}]}`))
	require.NoError(t, err)
	require.True(t, got.Enabled)
	require.Equal(t, int64(104857600), got.TotalBytes)
	require.Equal(t, []knowledgePersonalQuotaAllocation{{UserId: 8, QuotaBytes: 10485760}}, got.Allocations)

	_, err = parseKnowledgePersonalQuota(json.RawMessage(`{"enabled":true,"totalBytes":0}`))
	require.Error(t, err)
	_, err = parseKnowledgePersonalQuota(json.RawMessage(`{"enabled":true,"totalBytes":100,"allocations":[{"userId":1,"quotaBytes":80},{"userId":2,"quotaBytes":30}]}`))
	require.Error(t, err)
	_, err = parseKnowledgePersonalQuota(json.RawMessage(`{"enabled":true,"totalBytes":100,"allocations":[{"userId":1,"quotaBytes":10},{"userId":1,"quotaBytes":20}]}`))
	require.Error(t, err)
}

func TestFormatKnowledgeQuotaBytes(t *testing.T) {
	require.Equal(t, "100MB", formatKnowledgeQuotaBytes(100<<20))
	require.Equal(t, "1.5MB", formatKnowledgeQuotaBytes((3<<20)/2))
}

func TestEnforcePersonalKnowledgeQuotaDisabledPasses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previous := config.OptionMap
	config.OptionMap = map[string]string{
		"SystemDeploymentSettings": `{"network":"internet","knowledgeQuota":{"enabled":false,"totalBytes":0,"allocations":[]}}`,
	}
	t.Cleanup(func() { config.OptionMap = previous })

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	ok := enforcePersonalKnowledgeQuota(c, &model.KnowledgeBase{Kind: model.KnowledgeBasePersonal, OwnerUserId: 1}, 1024)
	require.True(t, ok)
	require.Equal(t, 200, recorder.Code)
}

func TestEnforcePersonalKnowledgeQuotaRejectsTotalOverflow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:knowledge_quota_total?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))
	require.NoError(t, db.Create(&model.KnowledgeBase{
		Name: "笔记", Kind: model.KnowledgeBasePersonal, OwnerUserId: 3, RagflowDatasetId: "ds-a",
	}).Error)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/documents") {
			_, _ = w.Write([]byte(`{"code":0,"data":{"docs":[{"id":"d1","name":"a.pdf","size":90}],"total":1}}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":null}`))
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")

	previous := config.OptionMap
	config.OptionMap = map[string]string{
		"SystemDeploymentSettings": `{"network":"internet","knowledgeQuota":{"enabled":true,"totalBytes":100,"allocations":[]}}`,
	}
	t.Cleanup(func() { config.OptionMap = previous })

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	ok := enforcePersonalKnowledgeQuota(c, &model.KnowledgeBase{
		Kind: model.KnowledgeBasePersonal, OwnerUserId: 3, RagflowDatasetId: "ds-a",
	}, 20)
	require.False(t, ok)
	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Contains(t, recorder.Body.String(), "个人知识库总容量已达上限")
}

func TestEnforcePersonalKnowledgeQuotaRejectsOwnerAllocation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:knowledge_quota_owner?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))
	require.NoError(t, db.Create(&model.KnowledgeBase{
		Name: "笔记", Kind: model.KnowledgeBasePersonal, OwnerUserId: 9, RagflowDatasetId: "ds-owner",
	}).Error)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/documents") {
			_, _ = w.Write([]byte(`{"code":0,"data":{"docs":[{"id":"d1","name":"a.pdf","size":40}],"total":1}}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":null}`))
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")

	previous := config.OptionMap
	config.OptionMap = map[string]string{
		"SystemDeploymentSettings": `{"network":"internet","knowledgeQuota":{"enabled":true,"totalBytes":1000,"allocations":[{"userId":9,"quotaBytes":50}]}}`,
	}
	t.Cleanup(func() { config.OptionMap = previous })

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	ok := enforcePersonalKnowledgeQuota(c, &model.KnowledgeBase{
		Kind: model.KnowledgeBasePersonal, OwnerUserId: 9, RagflowDatasetId: "ds-owner",
	}, 20)
	require.False(t, ok)
	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Contains(t, recorder.Body.String(), "您的个人知识库容量已达上限")
}

func TestParseDesktopDeploymentSettingsKnowledgeQuota(t *testing.T) {
	settings, err := parseDesktopDeploymentSettings(`{"network":"internet","knowledgeQuota":{"enabled":true,"totalBytes":104857600,"allocations":[]}}`)
	require.NoError(t, err)
	require.NotNil(t, settings.KnowledgeQuota)
	require.True(t, settings.KnowledgeQuota.Enabled)
	require.Equal(t, int64(104857600), settings.KnowledgeQuota.TotalBytes)

	_, err = parseDesktopDeploymentSettings(`{"network":"internet","knowledgeQuota":{"enabled":true,"totalBytes":0}}`)
	require.Error(t, err)
}
