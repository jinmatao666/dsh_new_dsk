package model

import (
	"github.com/songquanpeng/one-api/relay/channeltype"
	"testing"
)

func TestChannelAllowsExplicitCache(t *testing.T) {
	for _, test := range []struct {
		kind     int
		endpoint string
		allowed  bool
	}{
		{channeltype.AliBailian, "", true},
		{channeltype.AliBailian, "https://dashscope.aliyuncs.com/compatible-mode/v1", true},
		{channeltype.OpenAI, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", true},
		{channeltype.OpenAICompatible, "http://10.1.2.3:8000/v1", false},
		{channeltype.OpenAICompatible, "https://dashscope.aliyuncs.com/compatible-mode/v1", false},
		{channeltype.AliBailian, "http://127.0.0.1:8000/v1", false},
		{channeltype.AliBailian, "https://dashscope.aliyuncs.com.example.test/v1", false},
		{channeltype.OpenAI, "", false},
		{channeltype.Ollama, "http://localhost:11434", false},
	} {
		if got := ChannelAllowsExplicitCache(test.kind, test.endpoint); got != test.allowed {
			t.Errorf("kind=%d endpoint=%s got=%t want=%t", test.kind, test.endpoint, got, test.allowed)
		}
	}
}
