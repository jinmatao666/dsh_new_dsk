package ragflow

import (
	"strings"
	"testing"
)

func TestPlainTextAnswerKeepsMarkdownHierarchy(t *testing.T) {
	input := "1.  **本地打包**\n    在 PowerShell 中执行 `release.mjs`。\n\n## 上传\n[文档](https://example.com)"
	got := PlainTextAnswer(input)
	for _, want := range []string{"## 上传", "**本地打包**", "release.mjs", "[文档](https://example.com)"} {
		if !strings.Contains(got, want) {
			t.Fatalf("lost %q: %q", want, got)
		}
	}
}

func TestPlainTextAnswerUnwrapsFences(t *testing.T) {
	got := PlainTextAnswer("前言\n```text\n正文\n```\n结尾")
	if strings.Contains(got, "```") || !strings.Contains(got, "正文") {
		t.Fatalf("got=%q", got)
	}
}
