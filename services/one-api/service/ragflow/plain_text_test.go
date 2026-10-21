package ragflow

import (
	"strings"
	"testing"
)

func TestPlainTextAnswerStripsMarkdown(t *testing.T) {
	input := "1.  **本地打包**\n    在 PowerShell 中执行 `release.mjs`。\n\n## 上传\n[文档](https://example.com)"
	got := PlainTextAnswer(input)
	for _, mark := range []string{"**", "##", "`", "]("} {
		if strings.Contains(got, mark) {
			t.Fatalf("still contains %q: %q", mark, got)
		}
	}
	for _, want := range []string{"本地打包", "release.mjs", "文档"} {
		if !strings.Contains(got, want) {
			t.Fatalf("lost %q: %q", want, got)
		}
	}
}
