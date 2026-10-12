package controller

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/apitype"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

func TestWebDateContextScopeAndBeijingMidnight(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	request := &model.GeneralOpenAIRequest{}
	if needsWebDateContext(c, relaymode.ChatCompletions, request) {
		t.Fatal("ordinary chat must remain unchanged")
	}
	request.Tools = []model.Tool{{Type: "function", Function: model.Function{Name: "web_search"}}}
	if !needsWebDateContext(c, relaymode.ChatCompletions, request) || needsWebDateContext(c, relaymode.Completions, request) {
		t.Fatal("incorrect tool scope")
	}
	request.Tools = nil
	c.Set(ctxkey.WebSearch, true)
	if !needsWebDateContext(c, relaymode.ChatCompletions, request) {
		t.Fatal("marked search missing date context")
	}
	instruction := webDateInstruction(time.Date(2026, 10, 11, 16, 0, 0, 0, time.UTC))
	if !strings.Contains(instruction, "2026-10-12") || !strings.Contains(instruction, "Asia/Shanghai") {
		t.Fatal(instruction)
	}
	messages := appendWebDateContext([]model.Message{{Role: "system", Content: "原有规则"}, {Role: "user", Content: "查询2025-01-01的新闻"}}, instruction)
	if !strings.HasPrefix(messages[0].Content.(string), "原有规则\n\n") || messages[1].Content != "查询2025-01-01的新闻" {
		t.Fatal("replaced existing instructions or explicit user date")
	}
}

func TestWebDatePassThroughPreservesVendorFields(t *testing.T) {
	saved := config.EnforceIncludeUsage
	config.EnforceIncludeUsage = false
	defer func() { config.EnforceIncludeUsage = saved }()
	instruction := webDateInstruction(time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC))
	for _, content := range []string{`"规则"`, `[{"type":"text","text":"规则","cache_control":{"type":"ephemeral"}}]`} {
		raw := `{"model":"date-test","stream":true,"vendor_option":{"keep":true},"messages":[{"role":"system","content":` + content + `,"vendor_message":"keep"},{"role":"user","content":"今天的新闻","vendor_user":"keep"}]}`
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(raw))
		c.Set(webDateContextKey, instruction)
		metadata := &meta.Meta{Mode: relaymode.ChatCompletions, APIType: apitype.OpenAI, OriginModelName: "date-test", ActualModelName: "date-test"}
		reader, err := getRequestBody(c, metadata, &model.GeneralOpenAIRequest{}, &openai.Adaptor{})
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		if err := json.NewDecoder(reader).Decode(&result); err != nil {
			t.Fatal(err)
		}
		messages := result["messages"].([]any)
		first := messages[0].(map[string]any)
		if result["stream"] != true || result["vendor_option"].(map[string]any)["keep"] != true || first["vendor_message"] != "keep" || messages[1].(map[string]any)["vendor_user"] != "keep" {
			t.Fatal("pass-through fields lost")
		}
		encoded, _ := json.Marshal(first["content"])
		if !strings.Contains(string(encoded), "2026-10-12") || !strings.Contains(string(encoded), "规则") {
			t.Fatal("date or original content lost")
		}
		if blocks, ok := first["content"].([]any); ok && blocks[0].(map[string]any)["cache_control"] == nil {
			t.Fatal("cache metadata lost")
		}
	}
}

func TestWebDateContextPrependsWithoutSystem(t *testing.T) {
	instruction := "date context"
	messages := appendWebDateContext([]model.Message{{Role: "user", Content: "news"}}, instruction)
	if len(messages) != 2 || messages[0].Role != "system" || messages[1].Content != "news" {
		t.Fatal("invalid prepend")
	}
	reader, err := patchWebDateBody(strings.NewReader(`{"messages":[{"role":"user","content":"news"}],"unknown":42}`), instruction)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Messages []model.Message `json:"messages"`
		Unknown  int             `json:"unknown"`
	}
	if err := json.NewDecoder(reader).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if len(result.Messages) != 2 || result.Messages[0].Content != instruction || result.Unknown != 42 {
		t.Fatal("raw prepend failed")
	}
}

func TestWebDateContextReachesNativeSearch(t *testing.T) {
	instruction := webDateInstruction(time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC))
	for _, name := range []string{"qwen-plus", "qwen3.6-plus"} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{}`))
		c.Set(ctxkey.WebSearch, true)
		request := &model.GeneralOpenAIRequest{Model: name, Messages: appendWebDateContext([]model.Message{{Role: "user", Content: "新闻"}}, instruction)}
		reader, err := getRequestBody(c, &meta.Meta{Mode: relaymode.ChatCompletions, APIType: apitype.OpenAI, ActualModelName: name}, request, &openai.Adaptor{})
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Input struct {
				Messages []model.Message `json:"messages"`
			} `json:"input"`
		}
		if err := json.NewDecoder(reader).Decode(&result); err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(result.Input.Messages[0].Content)
		if result.Input.Messages[0].Role != "system" || !strings.Contains(string(encoded), "2026-10-12") || result.Input.Messages[1].Role != "user" {
			t.Fatalf("native search lost date: %s", encoded)
		}
	}
}
