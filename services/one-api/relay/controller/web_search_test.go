package controller

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/apitype"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

func TestMarkedSearchDoesNotBypassConversion(t *testing.T) {
	saved := config.EnforceIncludeUsage
	config.EnforceIncludeUsage = false
	defer func() { config.EnforceIncludeUsage = saved }()
	for _, marked := range []bool{false, true} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"qwen-plus","messages":[]}`))
		c.Set(ctxkey.WebSearch, marked)
		metadata := &meta.Meta{Mode: relaymode.ChatCompletions, APIType: apitype.OpenAI, ChannelType: channeltype.AliBailian, OriginModelName: "qwen-plus", ActualModelName: "qwen-plus"}
		body, err := getRequestBody(c, metadata, &model.GeneralOpenAIRequest{Model: "qwen-plus"}, &openai.Adaptor{})
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		if err := json.NewDecoder(body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		_, converted := result["parameters"]
		if converted != marked {
			t.Fatalf("marked=%v converted=%v", marked, converted)
		}
	}
}
