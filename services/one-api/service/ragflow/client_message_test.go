package ragflow

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
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
	if prompt["top_n"] != 6 {
		t.Fatalf("top_n=%v", prompt["top_n"])
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

func TestNormalizeSessionHistoryDropsPrologueAndMarkdown(t *testing.T) {
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
	if got[1].Role != "assistant" || got[1].Content != "知识库是资料集合。" {
		t.Fatalf("assistant=%#v", got[1])
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
			{"role":"assistant","content":"你好！"}
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
	if len(messages) != 2 || messages[0].Content != "你好" || messages[1].Content != "你好！" {
		t.Fatalf("messages=%#v", messages)
	}
}
