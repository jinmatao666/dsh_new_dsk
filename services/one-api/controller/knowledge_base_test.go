package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestKnowledgeUploadRejectsOverOneGiBWithoutOpeningFile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "large.mdb")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("MDB"))
	_ = writer.Close()
	c.Request = httptest.NewRequest(http.MethodPost, "/", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := c.Request.ParseMultipartForm(1024); err != nil {
		t.Fatal(err)
	}
	c.Request.MultipartForm.File["file"][0].Size = maxKnowledgeUploadBytes + 1
	uploadKnowledgeDocument(c, &model.KnowledgeBase{})
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestKnowledgeUploadAcceptsMDBAboveTwentyMiB(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/documents") {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			defer r.MultipartForm.RemoveAll()
			file, header, err := r.FormFile("file")
			if err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			defer file.Close()
			count, err := io.Copy(io.Discard, file)
			if err != nil || count != 21<<20 || header.Filename != "基础库.mdb" {
				t.Errorf("size=%d name=%s err=%v", count, header.Filename, err)
			}
			_, _ = io.WriteString(w, `{"code":0,"data":[]}`)
			return
		}
		_, _ = io.WriteString(w, `{"code":0,"data":null}`)
	}))
	defer upstream.Close()
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "基础库.mdb")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(make([]byte, 21<<20)); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	uploadKnowledgeDocument(c, &model.KnowledgeBase{RagflowDatasetId: "dataset"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestKnowledgeDocumentIDsSkipsEmpty(t *testing.T) {
	ids := knowledgeDocumentIDs([]ragflow.Document{
		{Id: "doc-1"},
		{Id: ""},
		{Id: "doc-2"},
	})
	if len(ids) != 2 || ids[0] != "doc-1" || ids[1] != "doc-2" {
		t.Fatalf("ids=%v", ids)
	}
	if got := knowledgeDocumentIDs(nil); len(got) != 0 {
		t.Fatalf("nil documents: %v", got)
	}
}

func TestUniqueKnowledgeDocumentNameKeepsAndSuffixes(t *testing.T) {
	existing := []ragflow.Document{{Name: "说明.pdf"}, {Name: "说明 (1).pdf"}}
	if got := uniqueKnowledgeDocumentName("指南.pdf", existing); got != "指南.pdf" {
		t.Fatalf("unused name: %s", got)
	}
	if got := uniqueKnowledgeDocumentName("说明.pdf", existing); got != "说明 (2).pdf" {
		t.Fatalf("conflict suffix: %s", got)
	}
	if got := documentsWithName(existing, "说明.pdf"); len(got) != 1 || got[0].Name != "说明.pdf" {
		t.Fatalf("name match: %v", got)
	}
}

func TestDeleteKnowledgeDocumentRejectsInvalidDocumentId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.DELETE("/api/knowledge-bases/:id/documents/:documentId", func(c *gin.Context) {
		c.Set("id", 1)
		DeleteKnowledgeDocument(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete, "/api/knowledge-bases/1/documents/bad!id", nil)
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid document id: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestCopyKnowledgeDocumentRejectsInvalidTarget(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/knowledge-bases/:id/documents/:documentId/copy", func(c *gin.Context) {
		c.Set("id", 1)
		CopyKnowledgeDocument(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/knowledge-bases/1/documents/doc-1/copy",
		strings.NewReader(`{"target_knowledge_base_id":0}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid target: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestStartKnowledgeDocumentParseNoopsWithoutIds(t *testing.T) {
	startKnowledgeDocumentParse(nil, "dataset", nil)
	startKnowledgeDocumentParse(nil, "dataset", []string{})
	startKnowledgeDocumentParse(nil, "", []string{"doc-1"})
}

func TestLimitKnowledgeRecommendationsKeepsThreeUnique(t *testing.T) {
	got := limitKnowledgeRecommendations([]string{"甲", "", "乙", "甲", "丙", "丁"})
	if len(got) != 3 || got[0] != "甲？" || got[1] != "乙？" || got[2] != "丙？" {
		t.Fatalf("unexpected recommendations: %#v", got)
	}
	kept := limitKnowledgeRecommendations([]string{"已有问号？", "ascii?"})
	if len(kept) != 2 || kept[0] != "已有问号？" || kept[1] != "ascii?" {
		t.Fatalf("existing marks: %#v", kept)
	}
	if got := limitKnowledgeRecommendations(nil); len(got) != 0 {
		t.Fatalf("nil input: %#v", got)
	}
}

func TestKnowledgeDocumentsStillParsingUsesDocumentStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(r.URL.RawQuery, "id=doc-run"):
			_, _ = w.Write([]byte(`{"code":0,"data":{"docs":[{"id":"doc-run","name":"a.pdf","run":"1","progress":0.2,"chunk_count":0}]}}`))
		case strings.Contains(r.URL.RawQuery, "id=doc-done"):
			_, _ = w.Write([]byte(`{"code":0,"data":{"docs":[{"id":"doc-done","name":"b.pdf","run":"DONE","progress":1,"chunk_count":3}]}}`))
		default:
			_, _ = w.Write([]byte(`{"code":0,"data":{"docs":[
				{"id":"doc-run","name":"a.pdf","run":"RUNNING","progress":0.2,"chunk_count":0},
				{"id":"doc-wait","name":"c.pdf","run":"UNSTART","progress":0,"chunk_count":0}
			],"total":2}}`))
		}
	}))
	defer server.Close()
	t.Setenv("RAGFLOW_BASE_URL", server.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	parsing, err := knowledgeDocumentsStillParsing(context.Background(), client, "ds-1", "doc-run")
	if err != nil || !parsing {
		t.Fatalf("targeted parsing: parsing=%v err=%v", parsing, err)
	}
	parsing, err = knowledgeDocumentsStillParsing(context.Background(), client, "ds-1", "doc-done")
	if err != nil || parsing {
		t.Fatalf("targeted ready: parsing=%v err=%v", parsing, err)
	}
	parsing, err = knowledgeDocumentsStillParsing(context.Background(), client, "ds-1")
	if err != nil || !parsing {
		t.Fatalf("library all pending: parsing=%v err=%v", parsing, err)
	}
	deferral, err := knowledgeAskDeferralFor(context.Background(), client, "ds-1", "doc-done")
	if err != nil || deferral != knowledgeAskReady {
		t.Fatalf("targeted chunks ready: deferral=%q err=%v", deferral, err)
	}
	deferral, err = knowledgeAskDeferralFor(context.Background(), client, "ds-1", "doc-run")
	if err != nil || deferral != knowledgeAskParsing {
		t.Fatalf("targeted still parsing: deferral=%q err=%v", deferral, err)
	}
	deferral, err = knowledgeAskDeferralFor(context.Background(), client, "ds-1")
	if err != nil || deferral != knowledgeAskParsing {
		t.Fatalf("library all pending deferral: deferral=%q err=%v", deferral, err)
	}
}

func TestKnowledgeAskDeferralNoChunks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"docs":[
			{"id":"doc-empty","name":"empty.pdf","run":"DONE","progress":1,"chunk_count":0},
			{"id":"doc-fail","name":"fail.pdf","run":"FAIL","progress":0,"chunk_count":0}
		],"total":2}}`))
	}))
	defer server.Close()
	t.Setenv("RAGFLOW_BASE_URL", server.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	deferral, err := knowledgeAskDeferralFor(context.Background(), client, "ds-empty")
	if err != nil || deferral != knowledgeAskNoChunks {
		t.Fatalf("done-without-chunks: deferral=%q err=%v", deferral, err)
	}
}

func TestChatCompletionsKnowledgeBaseRejectsInvalidId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/knowledge-bases/:id/chat/completions", func(c *gin.Context) {
		c.Set("id", 1)
		ChatCompletionsKnowledgeBase(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/knowledge-bases/abc/chat/completions",
		strings.NewReader(`{"question":"你好"}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid id: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestClearKnowledgeConversationMessagesRejectsInvalidId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.DELETE("/api/knowledge-bases/:id/chat/messages", func(c *gin.Context) {
		c.Set("id", 1)
		ClearKnowledgeConversationMessages(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete, "/api/knowledge-bases/abc/chat/messages", nil)
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid id: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestListKnowledgeConversationMessagesRejectsInvalidId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/api/knowledge-bases/:id/chat/messages", func(c *gin.Context) {
		c.Set("id", 1)
		ListKnowledgeConversationMessages(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/knowledge-bases/abc/chat/messages", nil)
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid id: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestListKnowledgeDocumentChunksRejectsInvalidDocumentId(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/api/knowledge-bases/:id/documents/:documentId/chunks", func(c *gin.Context) {
		c.Set("id", 1)
		ListKnowledgeDocumentChunks(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/knowledge-bases/1/documents/bad!id/chunks", nil)
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid document id: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestCreateKnowledgeBaseValidatesCatalogKind(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("RAGFLOW_BASE_URL", "")
	t.Setenv("RAGFLOW_API_KEY", "")
	engine := gin.New()
	engine.POST("/user", func(c *gin.Context) {
		c.Set("id", 1)
		CreateKnowledgeBase(c)
	})
	engine.POST("/admin", func(c *gin.Context) {
		c.Set("id", 1)
		CreateManagedKnowledgeBase(c)
	})
	post := func(path, body string) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	if got := post("/user", `{"name":"资料","kind":"nope"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("unknown kind: %d %s", got.Code, got.Body.String())
	}
	if got := post("/user", `{"name":"资料","kind":"common"}`); got.Code != http.StatusForbidden {
		t.Fatalf("desktop common: %d %s", got.Code, got.Body.String())
	}
	if got := post("/admin", `{"name":"资料","kind":"common"}`); got.Code != http.StatusServiceUnavailable {
		t.Fatalf("admin common: %d %s", got.Code, got.Body.String())
	}
	if got := post("/user", `{"name":"资料","kind":"personal","tags":"`+strings.Repeat("标", 201)+`"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("long tags: %d %s", got.Code, got.Body.String())
	}
	if got := post("/user", `{"name":"资料","kind":"personal","category_id":3}`); got.Code != http.StatusForbidden {
		t.Fatalf("user category: %d %s", got.Code, got.Body.String())
	}
}

func TestCreateKnowledgeCategoryRejectsInvalidInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/categories", CreateManagedKnowledgeCategory)
	post := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/categories", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	if got := post(`{"name":"","type":"personal"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("empty name: %d %s", got.Code, got.Body.String())
	}
	if got := post(`{"name":"部门规范","type":"other"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("unknown type: %d %s", got.Code, got.Body.String())
	}
}

func TestUpdateAndDeleteKnowledgeCategory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-category-admin?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}, &model.KnowledgeCategory{}))

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/categories", CreateManagedKnowledgeCategory)
	engine.PUT("/categories/:id", UpdateManagedKnowledgeCategory)
	engine.DELETE("/categories/:id", DeleteManagedKnowledgeCategory)

	create := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/categories", strings.NewReader(`{"name":"部门规范","type":"shared","require_auth":true}`))
	req.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(create, req)
	if create.Code != http.StatusOK {
		t.Fatalf("create: %d %s", create.Code, create.Body.String())
	}
	var created struct {
		Data struct {
			Id int `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil || created.Data.Id <= 0 {
		t.Fatalf("create body: %v %s", err, create.Body.String())
	}
	path := fmt.Sprintf("/categories/%d", created.Data.Id)

	update := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, path, strings.NewReader(`{"name":"规范汇编","type":"common","require_auth":false}`))
	req.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(update, req)
	if update.Code != http.StatusOK {
		t.Fatalf("update: %d %s", update.Code, update.Body.String())
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"code":0}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")

	require.NoError(t, model.DB.Create(&model.KnowledgeBase{
		Name: "filed", RagflowDatasetId: "ds-cat-1", OwnerUserId: 1, Kind: model.KnowledgeBaseCommon,
		Shelf: model.KnowledgeShelfPublished, CategoryId: created.Data.Id,
	}).Error)
	require.NoError(t, db.AutoMigrate(
		&model.KnowledgeBaseGrant{}, &model.KnowledgeSubscriptionApplication{},
		&model.KnowledgeConversation{}, &model.KnowledgeDocumentNote{}, &model.KnowledgeDocumentPath{},
	))

	deleted := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodDelete, path, nil)
	engine.ServeHTTP(deleted, req)
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete cascades libraries: %d %s", deleted.Code, deleted.Body.String())
	}
	var remaining int64
	require.NoError(t, model.DB.Model(&model.KnowledgeBase{}).Where("category_id = ?", created.Data.Id).Count(&remaining).Error)
	if remaining != 0 {
		t.Fatalf("libraries left after category delete: %d", remaining)
	}
	var categories int64
	require.NoError(t, model.DB.Model(&model.KnowledgeCategory{}).Where("id = ?", created.Data.Id).Count(&categories).Error)
	if categories != 0 {
		t.Fatalf("category row left after delete: %d", categories)
	}
}
