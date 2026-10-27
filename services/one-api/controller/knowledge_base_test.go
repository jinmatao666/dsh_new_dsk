package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/service/ragflow"
)

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
