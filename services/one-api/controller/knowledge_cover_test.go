package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
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

func knowledgeCoverPNG(t *testing.T) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 32, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 32; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 8), G: uint8(y * 8), B: 90, A: 255})
		}
	}
	var output bytes.Buffer
	require.NoError(t, png.Encode(&output, img))
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
}

func TestCreateKnowledgeBaseRejectsInvalidCoverBeforeRAGFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("RAGFLOW_BASE_URL", "")
	t.Setenv("RAGFLOW_API_KEY", "")
	engine := gin.New()
	engine.POST("/user", func(c *gin.Context) {
		c.Set("id", 1)
		CreateKnowledgeBase(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/user", strings.NewReader(`{"name":"资料","kind":"personal","cover":"not-an-image"}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "封面图片无效") {
		t.Fatalf("invalid cover: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestCreateKnowledgeBaseStoresCover(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-cover-create?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/datasets") {
			_, _ = w.Write([]byte(`{"code":0,"data":{"id":"ds-cover","name":"资料"}}`))
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
		c.Set("id", 4)
		CreateKnowledgeBase(c)
	})
	body, err := json.Marshal(map[string]string{
		"name": "资料", "kind": "personal", "description": "说明", "cover": knowledgeCoverPNG(t),
	})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/user", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("create: %d %s", recorder.Code, recorder.Body.String())
	}
	var created struct {
		Data struct {
			Id    int    `json:"id"`
			Cover string `json:"cover"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &created))
	require.Greater(t, created.Data.Id, 0)
	require.True(t, strings.HasPrefix(created.Data.Cover, "data:image/jpeg;base64,"))
	stored, err := model.GetKnowledgeBase(created.Data.Id)
	require.NoError(t, err)
	require.Equal(t, created.Data.Cover, stored.Cover)
}

func TestUpdateManagedKnowledgeBaseCover(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-cover-update?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}))
	require.NoError(t, model.DB.Create(&model.KnowledgeBase{
		Name: "规范", RagflowDatasetId: "ds-cover-edit", OwnerUserId: 1,
		Kind: model.KnowledgeBaseCommon, Shelf: model.KnowledgeShelfPublished,
	}).Error)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.PUT("/bases/:id", UpdateManagedKnowledgeBase)
	put := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPut, "/bases/1", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	coverBody, err := json.Marshal(map[string]string{"name": "规范", "cover": knowledgeCoverPNG(t)})
	require.NoError(t, err)
	replaced := put(string(coverBody))
	if replaced.Code != http.StatusOK {
		t.Fatalf("replace cover: %d %s", replaced.Code, replaced.Body.String())
	}
	stored, err := model.GetKnowledgeBase(1)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(stored.Cover, "data:image/jpeg;base64,"))
	kept := stored.Cover

	renamed := put(`{"name":"规范修订"}`)
	if renamed.Code != http.StatusOK {
		t.Fatalf("rename without cover: %d %s", renamed.Code, renamed.Body.String())
	}
	stored, err = model.GetKnowledgeBase(1)
	require.NoError(t, err)
	require.Equal(t, kept, stored.Cover)
	require.Equal(t, "规范修订", stored.Name)

	cleared := put(`{"name":"规范修订","cover":""}`)
	if cleared.Code != http.StatusOK {
		t.Fatalf("clear cover: %d %s", cleared.Code, cleared.Body.String())
	}
	stored, err = model.GetKnowledgeBase(1)
	require.NoError(t, err)
	require.Empty(t, stored.Cover)

	rejected := put(`{"cover":"not-an-image"}`)
	if rejected.Code != http.StatusBadRequest || !strings.Contains(rejected.Body.String(), "封面图片无效") {
		t.Fatalf("reject cover: %d %s", rejected.Code, rejected.Body.String())
	}
}
