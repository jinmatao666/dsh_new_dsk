package model

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`

	CompletionTokensDetails *CompletionTokensDetails `json:"completion_tokens_details,omitempty"`
	// PromptTokensDetails 承接上游返回的输入 token 细分，其中 cached_tokens 为 prompt cache 命中数。
	// 仅用于观测缓存命中率，不参与计费。
	PromptTokensDetails *PromptTokensDetails `json:"prompt_tokens_details,omitempty"`
}

type CompletionTokensDetails struct {
	ReasoningTokens          int `json:"reasoning_tokens"`
	AcceptedPredictionTokens int `json:"accepted_prediction_tokens"`
	RejectedPredictionTokens int `json:"rejected_prediction_tokens"`
}

type PromptTokensDetails struct {
	// CachedTokens：本次请求命中 prompt cache 的输入 token 数（各家 OpenAI 兼容模型通用字段）。
	CachedTokens int `json:"cached_tokens"`
	// CacheCreationInputTokens：本次请求用于创建缓存（写入）的 token 数。
	// 阿里云显式缓存会返回此字段；命中读取则填 CachedTokens。二者对应 cache_read / cache_write。
	CacheCreationInputTokens int `json:"cache_creation_input_tokens,omitempty"`
	TextTokens               int `json:"text_tokens,omitempty"`
	AudioTokens              int `json:"audio_tokens,omitempty"`
}

type Error struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Param   string `json:"param"`
	Code    any    `json:"code"`
}

type ErrorWithStatusCode struct {
	Error
	StatusCode int `json:"status_code"`
}
