package openai

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

func TestSearchURLAndStreaming(t *testing.T) {
	for _, base := range []string{"https://dashscope.example.com", "https://dashscope.example.com/compatible-mode/v1/", "https://dashscope.example.com/api/v1"} {
		got, err := searchRequestURL(base)
		if err != nil || got != "https://dashscope.example.com/api/v1/services/aigc/text-generation/generation" {
			t.Fatalf("URL: %q, %v", got, err)
		}
	}
	for _, base := range []string{"bad", "file:///tmp", "https://user:password@example.com", "https://example.com?key=x"} {
		if _, err := searchRequestURL(base); err == nil {
			t.Fatalf("accepted %s", base)
		}
	}
	if _, err := convertSearchRequest(relaymode.ChatCompletions, &model.GeneralOpenAIRequest{Stream: true}); err == nil {
		t.Fatal("accepted streaming")
	}
}

func TestSearchRoundTripPreservesSourcesAndUsage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/services/aigc/text-generation/generation" || r.Header.Get("Authorization") != "Bearer upstream-key" {
			t.Errorf("wrong upstream request")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["parameters"].(map[string]any)["search_options"].(map[string]any)["enable_source"] != true {
			t.Error("sources not requested")
		}
		io.WriteString(w, `{"request_id":"search-1","output":{"choices":[{"message":{"role":"assistant","content":"搜索答案"},"finish_reason":"stop"}],"search_info":{"search_results":[{"index":1,"title":"公告","url":"https://news.example.com/release"}]}},"usage":{"input_tokens":12,"output_tokens":5}}`)
	}))
	defer upstream.Close()
	saved := client.HTTPClient
	client.HTTPClient = upstream.Client()
	defer func() { client.HTTPClient = saved }()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader("{}"))
	c.Set(ctxkey.WebSearch, true)
	a := &Adaptor{}
	converted, err := a.ConvertRequest(c, relaymode.ChatCompletions, &model.GeneralOpenAIRequest{Model: "qwen-plus", Messages: []model.Message{{Role: "user", Content: "新闻"}}})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(converted)
	metadata := &meta.Meta{BaseURL: upstream.URL, APIKey: "upstream-key", ActualModelName: "qwen-plus"}
	resp, err := a.DoRequest(c, metadata, strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	usage, responseErr := a.DoResponse(c, resp, metadata)
	if responseErr != nil || usage.TotalTokens != 17 {
		t.Fatalf("response: %#v, %#v", usage, responseErr)
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result["search_info"].(map[string]any)["search_results"].([]any)[0].(map[string]any)["url"] != "https://news.example.com/release" {
		t.Fatal("source lost")
	}
}

func TestSearchDoesNotFollowRedirect(t *testing.T) {
	hit := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit = true }))
	defer target.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer upstream.Close()
	saved := client.HTTPClient
	client.HTTPClient = upstream.Client()
	defer func() { client.HTTPClient = saved }()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader("{}"))
	_, err := (&Adaptor{}).doSearchRequest(c, &meta.Meta{BaseURL: upstream.URL, APIKey: "secret"}, strings.NewReader("{}"))
	if err == nil || hit {
		t.Fatal("redirect was not rejected")
	}
}

func TestSearchInvalidResponses(t *testing.T) {
	for _, body := range []string{`not json`, `{}`, `{"code":"InvalidParameter","message":"unsupported"}`, strings.Repeat("x", 1024*1024+1)} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		err, usage := searchResponse(c, &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, "qwen-plus")
		if err == nil || usage != nil {
			t.Fatal("invalid search accepted")
		}
	}
}
