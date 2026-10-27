package ragflow

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListDocumentsPagePassesKeywordsAndPaging(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path + "?" + r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"docs":[{"id":"d1","name":"测绘.pdf","size":12,"chunk_count":3}],"total":41}}`))
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, apiKey: "secret", http: server.Client()}
	docs, total, err := client.ListDocumentsPage(context.Background(), "ds-1", 2, 20, "测绘")
	if err != nil {
		t.Fatal(err)
	}
	if total != 41 || len(docs) != 1 || docs[0].Id != "d1" {
		t.Fatalf("docs=%#v total=%d", docs, total)
	}
	if gotPath != "/api/v1/datasets/ds-1/documents?desc=true&keywords=%E6%B5%8B%E7%BB%98&orderby=update_time&page=2&page_size=20" {
		t.Fatalf("path=%s", gotPath)
	}
}

func TestListChunksPagesUntilTotal(t *testing.T) {
	var pages []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pages = append(pages, r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("page") {
		case "1":
			_, _ = w.Write([]byte(`{"code":0,"data":{"chunks":[{"id":"c1","content":"one"},{"id":"c2","content":"two"}],"total":3}}`))
		case "2":
			_, _ = w.Write([]byte(`{"code":0,"data":{"chunks":[{"id":"c3","content":"three"}],"total":3}}`))
		default:
			t.Fatalf("unexpected page %q", r.URL.Query().Get("page"))
		}
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, apiKey: "secret", http: server.Client()}
	chunks, err := client.ListChunks(context.Background(), "ds-1", "doc-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 3 || chunks[0].Id != "c1" || chunks[2].Content != "three" {
		t.Fatalf("chunks=%#v", chunks)
	}
	if len(pages) != 2 || pages[0] != "page=1&page_size=100" || pages[1] != "page=2&page_size=100" {
		t.Fatalf("pages=%v", pages)
	}
}

func TestParseDocumentsPostsChunks(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	var gotBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := json.Unmarshal(data, &gotBody); err != nil {
			t.Errorf("decode body: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":null,"message":"ok"}`))
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, apiKey: "secret", http: server.Client()}
	datasetId := "52be6ea0aa8d11f1aaa2b6a611044f4d"
	if err := client.ParseDocuments(context.Background(), datasetId, []string{"doc-1", "doc-2"}); err != nil {
		t.Fatal(err)
	}
	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s", gotMethod)
	}
	if gotPath != "/api/v1/datasets/"+datasetId+"/chunks" {
		t.Fatalf("path=%s", gotPath)
	}
	if gotAuth != "Bearer secret" {
		t.Fatalf("auth=%s", gotAuth)
	}
	ids, ok := gotBody["document_ids"].([]interface{})
	if !ok || len(ids) != 2 || ids[0] != "doc-1" || ids[1] != "doc-2" {
		t.Fatalf("body=%v", gotBody)
	}
}

func TestMapRagflowMessageNestedClauses(t *testing.T) {
	message := mapRagflowMessage("Query contains too_many_nested_clauses; maxClauseCount is set to 1277")
	if message == "" || message == "Query contains too_many_nested_clauses; maxClauseCount is set to 1277" {
		t.Fatalf("expected mapped message, got %q", message)
	}
	if !TooManyNestedClauses(errors.New("RAGFlow：" + message)) {
		t.Fatal("mapped message should still match TooManyNestedClauses")
	}
}

func TestChatPromptKeepsRetrievalBounded(t *testing.T) {
	prompt := chatPrompt("dataset-1")
	if prompt["top_k"] != 512 {
		t.Fatalf("top_k=%v", prompt["top_k"])
	}
	if prompt["top_n"] != 12 {
		t.Fatalf("top_n=%v", prompt["top_n"])
	}
	text, _ := prompt["prompt"].(string)
	if !strings.Contains(text, "回答须完整") {
		t.Fatalf("prompt missing completeness rule: %q", text)
	}
	if !strings.Contains(text, "Markdown") || !strings.Contains(text, "## 标题") {
		t.Fatalf("prompt missing markdown hierarchy rule: %q", text)
	}
	if prompt["similarity_threshold"] != 0.05 {
		t.Fatalf("similarity_threshold=%v", prompt["similarity_threshold"])
	}
	if prompt["empty_response"] != "" {
		t.Fatalf("empty_response=%v", prompt["empty_response"])
	}
}

func TestChatLLMRaisesMaxTokens(t *testing.T) {
	llm := chatLLM("qwen")
	if llm["model_name"] != "qwen" {
		t.Fatalf("model_name=%v", llm["model_name"])
	}
	if llm["max_tokens"] != 4096 || llm["max_token"] != 4096 {
		t.Fatalf("max tokens=%#v", llm)
	}
	payload := chatPayload("chat", "dataset-1", "qwen")
	if payload["llm"] == nil {
		t.Fatal("expected llm on create payload")
	}
	setting, _ := payload["llm_setting"].(map[string]interface{})
	if setting["max_token"] != 4096 {
		t.Fatalf("llm_setting=%#v", payload["llm_setting"])
	}
	if payload["llm_id"] != "qwen" {
		t.Fatalf("llm_id=%v", payload["llm_id"])
	}
}

func TestChatOwnershipLost(t *testing.T) {
	if !ChatOwnershipLost(errors.New("RAGFlow：You don't own the chat")) {
		t.Fatal("expected ownership loss detection")
	}
	if ChatOwnershipLost(errors.New("RAGFlow：timeout")) {
		t.Fatal("timeout is not ownership loss")
	}
}

func TestChunkViewerURLJoinsBaseAndIds(t *testing.T) {
	t.Setenv("RAGFLOW_BASE_URL", "http://ac.zjugis.com:9381/")
	got, err := ChunkViewerURL("dataset-1", "doc-2")
	if err != nil {
		t.Fatal(err)
	}
	if got != "http://ac.zjugis.com:9381/chunk/parsed/chunks?doc_id=doc-2&id=dataset-1" {
		t.Fatalf("url=%q", got)
	}
}

func TestCompleteSendsDocIdsAsCommaSeparatedString(t *testing.T) {
	var gotBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"answer":"ok","reference":null},"message":"ok"}`))
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, apiKey: "secret", http: server.Client()}
	if _, err := client.Complete(context.Background(), "chat-1", "sess-1", "总结", "doc-a", "doc-b"); err != nil {
		t.Fatal(err)
	}
	// RAGFlow dialog_service calls kwargs["doc_ids"].split(",") — arrays crash.
	if gotBody["doc_ids"] != "doc-a,doc-b" {
		t.Fatalf("doc_ids=%#v", gotBody["doc_ids"])
	}
}

func TestNormalizeSessionHistoryDropsPrologueAndKeepsMarkdown(t *testing.T) {
	got := NormalizeSessionHistory([]SessionMessage{
		{Role: "assistant", Content: "Hi! I am your assistant."},
		{Role: "user", Content: "  什么是知识库？  "},
		{Role: "assistant", Content: "**知识库**是资料集合。"},
		{Role: "system", Content: "ignored"},
		{Role: "assistant", Content: "   "},
	})
	if len(got) != 2 {
		t.Fatalf("len=%d %#v", len(got), got)
	}
	if got[0].Role != "user" || got[0].Content != "什么是知识库？" {
		t.Fatalf("user=%#v", got[0])
	}
	if got[1].Role != "assistant" || got[1].Content != "**知识库**是资料集合。" {
		t.Fatalf("assistant=%#v", got[1])
	}
}

func TestNormalizeSessionHistoryKeepsCitationMarkersAndCitations(t *testing.T) {
	reference := json.RawMessage(`[
		{"id":"c0","content":"建表说明","document_id":"doc-a","document_name":"制度.pdf","positions":[[1,10,20,30,40]]},
		{"id":"c1","content":"其它","document_id":"doc-b","document_name":"其它.pdf"}
	]`)
	got := NormalizeSessionHistory([]SessionMessage{
		{Role: "user", Content: "准备工作是什么"},
		{Role: "assistant", Content: "准备工作包括：[ID:0]", Reference: reference},
	})
	if len(got) != 2 {
		t.Fatalf("len=%d %#v", len(got), got)
	}
	if got[1].Content != "准备工作包括：[ID:0]" {
		t.Fatalf("content=%q", got[1].Content)
	}
	if len(got[1].Citations) != 1 || got[1].Citations[0].DocumentId != "doc-a" || got[1].Citations[0].ChunkIndex != 0 {
		t.Fatalf("citations=%#v", got[1].Citations)
	}
	if len(got[1].Reference) != 0 {
		t.Fatalf("raw reference should be cleared, got %#v", got[1].Reference)
	}
}

func TestDeleteSessionRemovesOneSession(t *testing.T) {
	var gotMethod, gotPath, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		data, _ := io.ReadAll(r.Body)
		gotBody = string(data)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":true,"message":"ok"}`))
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, apiKey: "secret", http: server.Client()}
	if err := client.DeleteSession(context.Background(), "chat-1", "sess-1"); err != nil {
		t.Fatal(err)
	}
	if gotMethod != http.MethodDelete || gotPath != "/api/v1/chats/chat-1/sessions" {
		t.Fatalf("request=%s %s", gotMethod, gotPath)
	}
	if gotBody != `{"ids":["sess-1"]}` {
		t.Fatalf("body=%s", gotBody)
	}
}

func TestListSessionMessagesFiltersById(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path + "?" + r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":[{"id":"sess-1","messages":[
			{"role":"assistant","content":"欢迎"},
			{"role":"user","content":"你好"},
			{"role":"assistant","content":"你好！[ID:0]","reference":[
				{"id":"c0","content":"摘录","document_id":"doc-1","document_name":"a.pdf","positions":[[2,1,2,3,4]]}
			]}
		]}],"message":"ok"}`))
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, apiKey: "secret", http: server.Client()}
	messages, err := client.ListSessionMessages(context.Background(), "chat-1", "sess-1")
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/api/v1/chats/chat-1/sessions?page=1&page_size=1&id=sess-1" {
		t.Fatalf("path=%s", gotPath)
	}
	if len(messages) != 2 || messages[0].Content != "你好" || messages[1].Content != "你好！[ID:0]" {
		t.Fatalf("messages=%#v", messages)
	}
	if len(messages[1].Citations) != 1 || messages[1].Citations[0].DocumentId != "doc-1" {
		t.Fatalf("citations=%#v", messages[1].Citations)
	}
}
