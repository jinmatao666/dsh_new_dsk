package anthropic

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCacheUsageIncludesAllInputBuckets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "json", true: "stream"}[stream], func(t *testing.T) {
			body := `{"id":"test","model":"claude","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":200,"output_tokens":500,"cache_read_input_tokens":700,"cache_creation_input_tokens":100}}`
			if stream {
				body = "data: " + `{"type":"message_start","message":{"id":"test","model":"claude","usage":{"input_tokens":200,"output_tokens":3,"cache_read_input_tokens":700,"cache_creation_input_tokens":100}}}` + "\n\n" +
					"data: " + `{"type":"message_delta","usage":{"output_tokens":10,"cache_read_input_tokens":700}}` + "\n\n" +
					"data: " + `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":500}}` + "\n\n"
			}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			resp := &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}
			if stream {
				err, usage := StreamHandler(c, resp)
				if err != nil || usage.PromptTokens != 1000 || usage.CompletionTokens != 500 || usage.PromptTokensDetails.CachedTokens != 700 || usage.PromptTokensDetails.CacheCreationInputTokens != 100 {
					t.Fatalf("incorrect stream usage: %+v %v", usage, err)
				}
			} else {
				err, usage := Handler(c, resp, 0, "claude")
				if err != nil || usage.PromptTokens != 1000 || usage.TotalTokens != 1500 || usage.PromptTokensDetails.CachedTokens != 700 || usage.PromptTokensDetails.CacheCreationInputTokens != 100 {
					t.Fatalf("incorrect json usage: %+v %v", usage, err)
				}
			}
		})
	}
}
