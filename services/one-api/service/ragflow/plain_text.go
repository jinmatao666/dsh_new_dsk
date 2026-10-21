package ragflow

import (
	"regexp"
	"strings"
)

var (
	markdownFence  = regexp.MustCompile("(?s)```[\\w-]*\\n?(.*?)```")
	markdownLink   = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`)
	markdownImage  = regexp.MustCompile(`!\[([^\]]*)\]\([^)]+\)`)
	markdownHeading = regexp.MustCompile(`(?m)^#{1,6}\s+`)
	markdownBold   = regexp.MustCompile(`(\*\*|__)(.+?)(\*\*|__)`)
	markdownItalic = regexp.MustCompile(`(\*|_)([^*_\n]+?)(\*|_)`)
	markdownCode   = regexp.MustCompile("`([^`]+)`")
	markdownQuote  = regexp.MustCompile(`(?m)^>\s?`)
	extraBlank     = regexp.MustCompile(`\n{3,}`)
)

// PlainTextAnswer removes Markdown markup so desktop chat can show plain prose.
func PlainTextAnswer(answer string) string {
	text := strings.ReplaceAll(answer, "\r\n", "\n")
	text = markdownFence.ReplaceAllString(text, "$1")
	text = markdownImage.ReplaceAllString(text, "$1")
	text = markdownLink.ReplaceAllString(text, "$1")
	text = markdownHeading.ReplaceAllString(text, "")
	text = markdownBold.ReplaceAllString(text, "$2")
	text = markdownItalic.ReplaceAllString(text, "$2")
	text = markdownCode.ReplaceAllString(text, "$1")
	text = markdownQuote.ReplaceAllString(text, "")
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = extraBlank.ReplaceAllString(text, "\n\n")
	return strings.TrimSpace(text)
}
