package controller

import (
	"fmt"
	"strings"
	"testing"
)

func TestNormalizeKnowledgeWebLinks(t *testing.T) {
	urls, err := normalizeKnowledgeWebLinks([]string{
		" https://example.com/a ",
		"https://example.com/a",
		"http://news.example.org/path?q=1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(urls) != 2 {
		t.Fatalf("urls=%v", urls)
	}
	if _, err := normalizeKnowledgeWebLinks(nil); err == nil || !strings.Contains(err.Error(), "请输入") {
		t.Fatalf("empty: %v", err)
	}
	tooMany := make([]string, 11)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("https://example.com/%d", i)
	}
	if _, err := normalizeKnowledgeWebLinks(tooMany); err == nil || !strings.Contains(err.Error(), "10") {
		t.Fatalf("limit: %v", err)
	}
	if _, err := normalizeKnowledgeWebLinks([]string{"ftp://example.com"}); err == nil {
		t.Fatal("expected scheme rejection")
	}
	if _, err := normalizeKnowledgeWebLinks([]string{"https://localhost/page"}); err == nil {
		t.Fatal("expected localhost rejection")
	}
	if _, err := normalizeKnowledgeWebLinks([]string{"https://user:pass@example.com"}); err == nil {
		t.Fatal("expected userinfo rejection")
	}
}
