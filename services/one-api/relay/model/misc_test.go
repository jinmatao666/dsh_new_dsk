package model

import (
	"encoding/json"
	"testing"
)

// TestUsageParsesPromptTokensDetails 验证 Usage 能正确解析上游返回的
// prompt_tokens_details.cached_tokens（prompt cache 命中数）。
// 这是 V2.5 的关键：此前 Usage 结构缺该字段，json.Unmarshal 会静默丢弃缓存信息，
// 导致后台 cache_read_tokens 恒为 0。
func TestUsageParsesPromptTokensDetails(t *testing.T) {
	// 模拟阿里云/OpenAI 兼容模型返回的、命中缓存的 usage 响应
	raw := `{
		"prompt_tokens": 3225,
		"completion_tokens": 20,
		"total_tokens": 3245,
		"prompt_tokens_details": {"cached_tokens": 2816, "cache_creation_input_tokens": 409, "text_tokens": 409},
		"completion_tokens_details": {"reasoning_tokens": 12}
	}`
	var u Usage
	if err := json.Unmarshal([]byte(raw), &u); err != nil {
		t.Fatalf("unmarshal 失败: %v", err)
	}
	if u.PromptTokensDetails == nil {
		t.Fatal("PromptTokensDetails 为 nil，缓存字段未被解析")
	}
	if u.PromptTokensDetails.CachedTokens != 2816 {
		t.Errorf("cached_tokens 期望 2816，实际 %d", u.PromptTokensDetails.CachedTokens)
	}
	if u.PromptTokensDetails.CacheCreationInputTokens != 409 {
		t.Errorf("cache_creation_input_tokens 期望 409，实际 %d", u.PromptTokensDetails.CacheCreationInputTokens)
	}
	if u.PromptTokensDetails.TextTokens != 409 {
		t.Errorf("text_tokens 期望 409，实际 %d", u.PromptTokensDetails.TextTokens)
	}
	// 回归保护：不影响既有字段解析
	if u.PromptTokens != 3225 || u.CompletionTokens != 20 {
		t.Errorf("基础 token 字段解析异常: prompt=%d completion=%d", u.PromptTokens, u.CompletionTokens)
	}
}

// TestUsageWithoutCacheDetails 验证上游不返回 prompt_tokens_details 时不报错、字段为 nil。
func TestUsageWithoutCacheDetails(t *testing.T) {
	raw := `{"prompt_tokens": 42, "completion_tokens": 90, "total_tokens": 132}`
	var u Usage
	if err := json.Unmarshal([]byte(raw), &u); err != nil {
		t.Fatalf("unmarshal 失败: %v", err)
	}
	if u.PromptTokensDetails != nil {
		t.Errorf("无 details 时应为 nil，实际 %+v", u.PromptTokensDetails)
	}
}
