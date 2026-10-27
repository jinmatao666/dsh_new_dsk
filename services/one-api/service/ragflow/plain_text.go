package ragflow

import (
	"regexp"
	"strings"
)

var (
	markdownFence = regexp.MustCompile("(?s)```[\\w-]*\\n?(.*?)```")
	markdownImage = regexp.MustCompile(`!\[([^\]]*)\]\([^)]+\)`)
	extraBlank    = regexp.MustCompile(`\n{3,}`)
)

// PlainTextAnswer normalizes a RAGFlow answer for the desktop Markdown renderer.
// Headings, lists, and emphasis are kept; fenced code is unwrapped and excess blank lines collapse.
func PlainTextAnswer(answer string) string {
	text := strings.ReplaceAll(answer, "\r\n", "\n")
	text = markdownFence.ReplaceAllString(text, "$1")
	text = markdownImage.ReplaceAllString(text, "$1")
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = extraBlank.ReplaceAllString(text, "\n\n")
	return strings.TrimSpace(text)
}
