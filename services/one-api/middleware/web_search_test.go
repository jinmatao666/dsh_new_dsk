package middleware

import "testing"

func TestBailianModelSupportsWebSearch(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		model string
		want  bool
	}{
		{name: "configured plus model", model: "qwen3.6-plus", want: true},
		{name: "dated snapshot", model: "qwen3.6-plus-2026-09-01", want: true},
		{name: "legacy search model", model: "qwen-plus", want: true},
		{name: "unsupported open model", model: "qwen3.8-27b-fp8", want: false},
		{name: "unrelated model", model: "deepseek-chat", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := bailianModelSupportsWebSearch(tt.model); got != tt.want {
				t.Fatalf("bailianModelSupportsWebSearch(%q) = %v, want %v", tt.model, got, tt.want)
			}
		})
	}
}
