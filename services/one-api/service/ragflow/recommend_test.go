package ragflow

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRecommendFallsBackPastMissingChatRoutes(t *testing.T) {
	var hit []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = append(hit, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/sessions/related_questions":
			_, _ = io.WriteString(w, `{"code":0,"data":["甲","乙","丙"],"message":"success"}`)
		default:
			_, _ = io.WriteString(w, `{"code":100,"data":null,"message":"<NotFound '404: Not Found'>"}`)
		}
	}))
	t.Cleanup(server.Close)

	client := &Client{baseURL: server.URL, apiKey: "test-key", http: server.Client()}
	got, err := client.Recommend(context.Background(), "知识库有哪些文档？")
	if err != nil {
		t.Fatalf("Recommend: %v", err)
	}
	if len(got) != 3 || got[0] != "甲" || got[1] != "乙" || got[2] != "丙" {
		t.Fatalf("unexpected questions: %#v", got)
	}
	if len(hit) != 1 || hit[0] != "/api/v1/sessions/related_questions" {
		t.Fatalf("unexpected hits: %#v", hit)
	}
}

func TestRecommendTriesNextEndpointWhenFirstMissing(t *testing.T) {
	var hit []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = append(hit, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/chat/recommendation":
			body, _ := io.ReadAll(r.Body)
			var payload map[string]string
			_ = json.Unmarshal(body, &payload)
			if payload["question"] != "q" {
				t.Errorf("unexpected body: %s", body)
			}
			_, _ = io.WriteString(w, `{"code":0,"data":["下一问"],"message":"success"}`)
		case "/api/v1/sessions/related_questions":
			_, _ = io.WriteString(w, `{"code":100,"data":null,"message":"<NotFound '404: Not Found'>"}`)
		default:
			_, _ = io.WriteString(w, `{"code":100,"data":null,"message":"unexpected"}`)
		}
	}))
	t.Cleanup(server.Close)

	client := &Client{baseURL: server.URL, apiKey: "test-key", http: server.Client()}
	got, err := client.Recommend(context.Background(), "q")
	if err != nil {
		t.Fatalf("Recommend: %v", err)
	}
	if len(got) != 1 || got[0] != "下一问" {
		t.Fatalf("unexpected questions: %#v", got)
	}
	if len(hit) != 2 || hit[0] != "/api/v1/sessions/related_questions" || hit[1] != "/api/v1/chat/recommendation" {
		t.Fatalf("unexpected hits: %#v", hit)
	}
}
