package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestListManagedRagflowDatasetsOmitsBound(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-ragflow-list?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))
	require.NoError(t, model.DB.Create(&model.KnowledgeBase{
		Name: "已关联", RagflowDatasetId: "ds-bound", OwnerUserId: 1,
		Kind: model.KnowledgeBasePersonal, Shelf: model.KnowledgeShelfPublished,
	}).Error)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/datasets") {
			_, _ = w.Write([]byte(`{"code":0,"data":[{"id":"ds-bound","name":"已关联"},{"id":"ds-free","name":"可关联"}],"total_datasets":2}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/datasets", ListManagedRagflowDatasets)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/datasets", nil)
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list: %d %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data []struct {
			Id   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Len(t, body.Data, 1)
	require.Equal(t, "ds-free", body.Data[0].Id)
}

func TestCreateKnowledgeBaseBindsExistingDataset(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-ragflow-bind?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))

	var createdRemote bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/datasets") {
			createdRemote = true
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"code":102,"message":"should not create"}`))
			return
		}
		if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/datasets") {
			_, _ = w.Write([]byte(`{"code":0,"data":[{"id":"ds-import","name":"平台库"}]}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/admin", func(c *gin.Context) {
		c.Set("id", 7)
		c.Set("knowledge_admin", true)
		CreateKnowledgeBase(c)
	})
	body, err := json.Marshal(map[string]interface{}{
		"name": "平台库本地名", "kind": "personal", "ragflow_dataset_id": "ds-import",
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("create: %d %s", recorder.Code, recorder.Body.String())
	}
	require.False(t, createdRemote)
	var created struct {
		Data struct {
			Id int `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &created))
	stored, err := model.GetKnowledgeBase(created.Data.Id)
	require.NoError(t, err)
	require.Equal(t, "ds-import", stored.RagflowDatasetId)
	require.Equal(t, "平台库本地名", stored.Name)
}

func TestCreateKnowledgeBaseBindsExistingDatasetForAnyUser(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-ragflow-user-bind?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/datasets") {
			_, _ = w.Write([]byte(`{"code":0,"data":[{"id":"ds-user","name":"个人已有"}]}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/user", func(c *gin.Context) {
		c.Set("id", 3)
		CreateKnowledgeBase(c)
	})
	body, err := json.Marshal(map[string]interface{}{
		"name": "个人已有", "kind": "personal", "ragflow_dataset_id": "ds-user",
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/user", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("user bind: %d %s", recorder.Code, recorder.Body.String())
	}
	var created struct {
		Data struct {
			Id int `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &created))
	stored, err := model.GetKnowledgeBase(created.Data.Id)
	require.NoError(t, err)
	require.Equal(t, "ds-user", stored.RagflowDatasetId)
	require.Equal(t, 3, stored.OwnerUserId)
}

func TestCreateKnowledgeBaseRejectsAlreadyBoundDataset(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-ragflow-dup?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))
	require.NoError(t, model.DB.Create(&model.KnowledgeBase{
		Name: "旧", RagflowDatasetId: "ds-dup", OwnerUserId: 1,
		Kind: model.KnowledgeBasePersonal, Shelf: model.KnowledgeShelfPublished,
	}).Error)
	t.Setenv("RAGFLOW_BASE_URL", "http://127.0.0.1:9")
	t.Setenv("RAGFLOW_API_KEY", "test-key")

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/admin", func(c *gin.Context) {
		c.Set("id", 1)
		c.Set("knowledge_admin", true)
		CreateKnowledgeBase(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin",
		strings.NewReader(`{"name":"再绑","kind":"personal","ragflow_dataset_id":"ds-dup"}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "该知识库已关联到管理工作台") {
		t.Fatalf("duplicate bind: %d %s", recorder.Code, recorder.Body.String())
	}
}
