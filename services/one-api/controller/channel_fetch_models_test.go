package controller

import (
	"strings"
	"testing"

	"github.com/songquanpeng/one-api/relay/channeltype"
)

// TestMaskKey 校验密钥脱敏：保留前后各 3 位，过短全打码，多 key 取第一个。
func TestMaskKey(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"正常长密钥", "sk-1234567890abcdef", "sk-···def"},
		{"恰好7位", "abcdefg", "abc···efg"},
		{"边界6位全打码", "abcdef", "******"},
		{"空串", "", ""},
		{"仅空白", "   ", ""},
		{"多key取第一个", "sk-aaaaaaaaa\nsk-bbbbbbbbb", "sk-···aaa"},
		{"首尾空白被裁", "  sk-xxxxxxxxx  ", "sk-···xxx"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := maskKey(c.in); got != c.want {
				t.Errorf("maskKey(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// TestCanAutoFetchModels 校验自动拉取白名单：OpenAI 兼容类放行，原生协议拒绝。
func TestCanAutoFetchModels(t *testing.T) {
	allow := []int{
		channeltype.OpenAI, channeltype.Anthropic, channeltype.Custom,
		channeltype.OpenAICompatible, channeltype.GeminiOpenAICompatible,
		channeltype.AliBailian, channeltype.DeepSeek, channeltype.Groq,
	}
	for _, ct := range allow {
		if !canAutoFetchModels(ct) {
			t.Errorf("canAutoFetchModels(%d) = false, want true", ct)
		}
	}
	deny := []int{
		channeltype.Ali,     // 通义千问原生 DashScope，无 /v1/models
		channeltype.Baidu,   // 文心原生
		channeltype.Xunfei,  // 讯飞原生
		channeltype.Gemini,  // Gemini 原生
		channeltype.Tencent, // 混元
	}
	for _, ct := range deny {
		if canAutoFetchModels(ct) {
			t.Errorf("canAutoFetchModels(%d) = true, want false", ct)
		}
	}
}

// TestModelsEndpoint 校验各渠道列模型地址拼接（百炼 compatible-mode、Gemini openai 前缀）。
func TestModelsEndpoint(t *testing.T) {
	cases := []struct {
		name    string
		ct      int
		baseURL string
		want    string
	}{
		{"通用 OpenAI", channeltype.OpenAI, "https://api.openai.com", "https://api.openai.com/v1/models"},
		{"去尾斜杠", channeltype.OpenAI, "https://api.openai.com/", "https://api.openai.com/v1/models"},
		{"百炼补 compatible-mode", channeltype.AliBailian, "https://dashscope.aliyuncs.com", "https://dashscope.aliyuncs.com/compatible-mode/v1/models"},
		{"百炼已含 compatible-mode 不重复", channeltype.AliBailian, "https://dashscope.aliyuncs.com/compatible-mode", "https://dashscope.aliyuncs.com/compatible-mode/v1/models"},
		{"Gemini 兼容含 openai 前缀直挂 models", channeltype.GeminiOpenAICompatible, "https://generativelanguage.googleapis.com/v1beta/openai/", "https://generativelanguage.googleapis.com/v1beta/openai/models"},
		{"Gemini 兼容无 openai 走默认", channeltype.GeminiOpenAICompatible, "https://example.com", "https://example.com/v1/models"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := modelsEndpoint(c.ct, c.baseURL); got != c.want {
				t.Errorf("modelsEndpoint(%d, %q) = %q, want %q", c.ct, c.baseURL, got, c.want)
			}
		})
	}
}

// TestResolveBaseURL 校验空 baseURL 回退到渠道类型默认地址。
func TestResolveBaseURL(t *testing.T) {
	// 显式 baseURL 原样返回（去尾斜杠）
	if got := resolveBaseURL(channeltype.OpenAI, "https://proxy.example.com/"); got != "https://proxy.example.com" {
		t.Errorf("显式 baseURL = %q, want https://proxy.example.com", got)
	}
	// 空 baseURL 回退默认（OpenAI 默认 https://api.openai.com）
	got := resolveBaseURL(channeltype.OpenAI, "")
	if !strings.HasPrefix(got, "https://api.openai.com") {
		t.Errorf("空 baseURL 回退 = %q, want 含 api.openai.com", got)
	}
	// 百炼空 baseURL 回退到 dashscope
	if got := resolveBaseURL(channeltype.AliBailian, ""); !strings.Contains(got, "dashscope") {
		t.Errorf("百炼空 baseURL 回退 = %q, want 含 dashscope", got)
	}
}
