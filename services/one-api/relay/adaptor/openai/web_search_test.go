package openai

import (
	"encoding/json"
	"fmt"
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

func TestMultimodalSearchRoundTrip(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/services/aigc/multimodal-generation/generation" || r.Header.Get("X-DashScope-SSE") != "enable" {
			t.Error("multimodal search must request the streaming multimodal endpoint")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		parameters := body["parameters"].(map[string]any)
		if parameters["incremental_output"] != true || parameters["enable_thinking"] != false || parameters["enable_search"] != true {
			t.Error("incorrect streaming parameters")
		}
		message := body["input"].(map[string]any)["messages"].([]any)[0].(map[string]any)
		if message["content"].([]any)[0].(map[string]any)["text"] != "新闻" {
			t.Error("incorrect multimodal message")
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		io.WriteString(w, ": keepalive\r\nevent: result\r\ndata: {\"request_id\":\"stream-1\",\"output\":{\"choices\":[{\"message\":{\"content\":[{\"text\":\"搜索\"}]},\"finish_reason\":\"null\"}],\"search_info\":{\"search_results\":[{\"title\":\"公告\",\"url\":\"https://news.example.com/release\"}]}},\"usage\":{\"input_tokens\":12,\"output_tokens\":1}}\r\n\r\n")
		io.WriteString(w, "data: {\"request_id\":\"stream-1\",\"output\":{\"choices\":[{\"message\":{\"content\":[{\"text\":\"答案\"}]},\"finish_reason\":\"stop\"}]},\"usage\":{\"input_tokens\":12,\"output_tokens\":5}}\n\ndata: [DONE]\n\n")
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
	converted, err := a.ConvertRequest(c, relaymode.ChatCompletions, &model.GeneralOpenAIRequest{Model: "qwen3.6-plus", Messages: []model.Message{{Role: "user", Content: "新闻"}}})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(converted)
	metadata := &meta.Meta{BaseURL: upstream.URL + "/compatible-mode/v1", ActualModelName: "qwen3.6-plus"}
	resp, err := a.DoRequest(c, metadata, strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	usage, responseErr := a.DoResponse(c, resp, metadata)
	if responseErr != nil || usage == nil || usage.TotalTokens != 17 {
		t.Fatalf("response: %v, %v", usage, responseErr)
	}
	var result struct {
		Choices    []TextResponseChoice `json:"choices"`
		SearchInfo struct {
			Results []any `json:"search_results"`
		} `json:"search_info"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Choices[0].Content != "搜索答案" || len(result.SearchInfo.Results) != 1 {
		t.Fatalf("lost text or earlier sources: %s", w.Body.String())
	}
}

func TestSearchModelProtocols(t *testing.T) {
	for _, name := range []string{"qwen3.5-plus", "qwen3.6-plus", "qwen3.6-plus-2026-04-02", "qwen3.7-plus", "qwen3.7-flash", "qwen3.8-max", "qwen3.8-flash", "qwen3.7-max-2026-06-08"} {
		if !multimodalSearch(name) {
			t.Errorf("expected multimodal: %s", name)
		}
	}
	for _, name := range []string{"qwen-plus", "qwen-max", "qwq-plus", "qwen3-max", "qwen3.7-max-2026-05-20"} {
		if multimodalSearch(name) {
			t.Errorf("expected text: %s", name)
		}
	}
	_, err := convertSearchRequest(relaymode.ChatCompletions, &model.GeneralOpenAIRequest{Model: "qwen3.6-plus", Messages: []model.Message{{Content: []any{}}}})
	if err == nil {
		t.Fatal("accepted non-text search request")
	}
}

func TestSearchStreamRejectsPartialAndErrors(t *testing.T) {
	for _, body := range []string{
		"data: not json\n\n",
		"data: {\"output\":{\"choices\":[{\"message\":{\"content\":[{\"text\":\"partial\"}]}}]}}\n\n",
		"data: {\"code\":\"InvalidParameter\",\"message\":\"wrong endpoint\"}\n\n",
		"data: [DONE]\n\n",
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		err, usage := searchResponse(c, &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, "qwen3.6-plus")
		if err == nil || usage != nil {
			t.Fatal("returned partial or invalid stream")
		}
	}
}

func TestSearchStreamLargeRepeatedMetadata(t *testing.T) {
	// Real streams repeat cumulative source metadata; wire size is not answer size.
	frame := `{"output":{"search_info":{"search_results":[{"url":"https://news.example.com/release","title":"` + strings.Repeat("x", 16000) + `"}]}}}`
	body := strings.Repeat("data: "+frame+"\n\n", 100) + searchTestAnswer("完成", "stop")
	if len(body) <= maxSearchResponseBytes {
		t.Fatal("fixture must exceed the old wire limit")
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	err, usage := searchResponse(c, &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, "qwen3.6-plus")
	if err != nil || usage == nil {
		t.Fatalf("large stream rejected: %v", err)
	}
	var result struct {
		Choices    []TextResponseChoice `json:"choices"`
		SearchInfo struct {
			Results []any `json:"search_results"`
		} `json:"search_info"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Choices[0].Content != "完成" || len(result.SearchInfo.Results) != 1 || w.Body.Len() > maxSearchResponseBytes {
		t.Fatalf("incorrect aggregation: %s", w.Body.String())
	}
}

func searchTestAnswer(text, finish string) string {
	content, _ := json.Marshal(text)
	return fmt.Sprintf("data: {\"output\":{\"choices\":[{\"message\":{\"content\":%s},\"finish_reason\":%q}]},\"usage\":{\"input_tokens\":12,\"output_tokens\":5}}\n\n", content, finish)
}

func TestSearchStreamBudgetsAndLateFailures(t *testing.T) {
	completed := searchTestAnswer("answer", "stop")
	var sourceFrames strings.Builder
	for i := 0; i <= maxSearchSources; i++ {
		fmt.Fprintf(&sourceFrames, "data: {\"output\":{\"search_info\":{\"search_results\":[{\"url\":\"https://example.com/%d\"}]}}}\n\n", i)
	}
	cases := map[string]string{
		"answer":          searchTestAnswer(strings.Repeat("x", maxSearchAnswerBytes+1), "stop"),
		"line":            "data: " + strings.Repeat("x", maxSearchFrameBytes+1) + "\n\n",
		"multiline frame": strings.Repeat(": comment\n", maxSearchFrameBytes/10+1) + "\n",
		"wire":            strings.Repeat(": heartbeat\n\n", maxSearchWireBytes/13+1) + completed,
		"source count":    sourceFrames.String() + completed,
		"source bytes":    `data: {"output":{"search_info":{"search_results":[{"title":"` + strings.Repeat("x", maxSearchSourceBytes+1) + `"}]}}}` + "\n\n" + completed,
		"late error":      completed + "data: [DONE]\n\ndata: {\"code\":\"UpstreamError\",\"message\":\"failed\"}\n\n",
		"late malformed":  completed + "data: broken\n\n",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			err, usage := searchResponse(c, &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}, "qwen3.6-plus")
			if err == nil || usage != nil || w.Body.Len() != 0 {
				t.Fatalf("invalid stream returned an answer: %v", err)
			}
		})
	}
}

func TestSearchStreamDeduplicatesURLsAndUsesFinalUsage(t *testing.T) {
	body := "data: {\"output\":{\"search_info\":{\"search_results\":[{\"index\":1,\"url\":\"https://example.com/a\"}]}},\"usage\":{\"input_tokens\":12,\"output_tokens\":1}}\n\n" +
		"data: {\"output\":{\"search_info\":{\"search_results\":[{\"index\":2,\"url\":\"https://example.com/a\"}]}}}\n\n" + searchTestAnswer("answer", "stop")
	result, err := aggregateSearchStream(strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Output struct {
			SearchInfo struct {
				Results []any `json:"search_results"`
			} `json:"search_info"`
		} `json:"output"`
		Usage struct {
			Output int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		t.Fatal(err)
	}
	if len(parsed.Output.SearchInfo.Results) != 1 || parsed.Usage.Output != 5 {
		t.Fatalf("duplicate sources or summed cumulative usage: %s", result)
	}
}
