package ragflow

import "testing"

func TestSplitDocumentUploadPath(t *testing.T) {
	parent, base := SplitDocumentUploadPath(`资料\子目录\说明.pdf`, "")
	if parent != "资料/子目录" || base != "说明.pdf" {
		t.Fatalf("got parent=%q base=%q", parent, base)
	}
	parent, base = SplitDocumentUploadPath("说明.pdf", "项目/文档")
	if parent != "项目/文档" || base != "说明.pdf" {
		t.Fatalf("explicit parent got parent=%q base=%q", parent, base)
	}
	parent, base = SplitDocumentUploadPath("说明.pdf", "../secret")
	if parent != "secret" || base != "说明.pdf" {
		t.Fatalf("parent traversal got parent=%q base=%q", parent, base)
	}
	parent, base = SplitDocumentUploadPath("root.txt", "")
	if parent != "" || base != "root.txt" {
		t.Fatalf("flat file got parent=%q base=%q", parent, base)
	}
}
