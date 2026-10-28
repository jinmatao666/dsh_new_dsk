package ragflow

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseCitationsFromMarkedAnswer(t *testing.T) {
	reference := json.RawMessage(`{
		"chunks": [
			{
				"id": "c0",
				"content": "第一条 适用范围",
				"document_id": "doc-a",
				"document_name": "制度.pdf",
				"positions": [[2, 72.5, 320.0, 640.0, 700.25]]
			},
			{
				"id": "c1",
				"content": "第 5 页补充说明",
				"document_id": "doc-b",
				"document_name": "说明.pdf",
				"page": 5
			}
		]
	}`)
	citations := ParseCitations(reference, "依据制度执行。##0$$ 另见说明。##1$$")
	if len(citations) != 2 {
		t.Fatalf("citations=%#v", citations)
	}
	if citations[0].Index != 1 || citations[0].ChunkIndex != 0 || citations[0].DocumentId != "doc-a" {
		t.Fatalf("first=%#v", citations[0])
	}
	if citations[0].Page == nil || *citations[0].Page != 2 || len(citations[0].Positions) != 1 {
		t.Fatalf("first page/positions=%#v", citations[0])
	}
	if citations[1].DocumentId != "doc-b" || citations[1].Page == nil || *citations[1].Page != 5 {
		t.Fatalf("second=%#v", citations[1])
	}
}

func TestParseCitationsFromSingleHashMarkers(t *testing.T) {
	reference := json.RawMessage(`{
		"chunks": [
			{"id":"c0","content":"材料一","document_id":"doc-a","document_name":"a.pdf"},
			{"id":"c1","content":"材料二","document_id":"doc-b","document_name":"b.pdf"},
			{"id":"c2","content":"材料三","document_id":"doc-c","document_name":"c.pdf"}
		]
	}`)
	// Model sometimes emits #i$ instead of ##i$$; ##0$$ must still win when both forms appear.
	citations := ParseCitations(reference, "申请材料清单#2$#1$#0$: 以及正式标记##0$$")
	if len(citations) != 3 {
		t.Fatalf("citations=%#v", citations)
	}
	if citations[0].ChunkIndex != 2 || citations[1].ChunkIndex != 1 || citations[2].ChunkIndex != 0 {
		t.Fatalf("order=%#v", citations)
	}
}

func TestParseCitationsFromIdMarkers(t *testing.T) {
	reference := json.RawMessage(`{"chunks":[
		{"id":"c0","content":"正文","document_id":"doc-a","document_name":"a.pdf","position_int":[[0,0.1,0.8,0.2,0.3]]},
		{"id":"c1","content":"其它","document_id":"doc-b","document_name":"b.pdf","page":3}
	]}`)
	citations := ParseCitations(reference, "准备工作包括：[ID:0]")
	if len(citations) != 1 {
		t.Fatalf("citations=%#v", citations)
	}
	if citations[0].Index != 1 || citations[0].ChunkIndex != 0 || citations[0].DocumentId != "doc-a" {
		t.Fatalf("first=%#v", citations[0])
	}
	if citations[0].Page == nil || *citations[0].Page != 0 || len(citations[0].Positions) != 1 {
		t.Fatalf("positions=%#v", citations[0])
	}
}

func TestParseCitationsOmitsSourcesWithoutMarkers(t *testing.T) {
	reference := json.RawMessage(`{"chunks":[{"id":"c0","content":"正文","document_id":"doc-a","document_name":"a.pdf","position_int":[[0,0.1,0.8,0.2,0.3]]}]}`)
	citations := ParseCitations(reference, "没有标注的回答")
	if len(citations) != 0 {
		t.Fatalf("citations=%#v", citations)
	}
}

func TestParseCitationsOmitsEmptyRetrievalAnswers(t *testing.T) {
	reference := json.RawMessage(`{"chunks":[{"id":"c0","content":"旧内容","document_id":"doc-a","document_name":"a.pdf","positions":[[1,1,2,3,4]]}]}`)
	citations := ParseCitations(reference, "知识库中未找到相关内容。##0$$")
	if len(citations) != 0 {
		t.Fatalf("citations=%#v", citations)
	}
}

func TestPlainTextAnswerKeepsCitationMarkers(t *testing.T) {
	got := PlainTextAnswer("结论如下：##0$$ 以及 **强调**。")
	if !strings.Contains(got, "##0$$") || !strings.Contains(got, "**强调**") {
		t.Fatalf("got=%q", got)
	}
	gotId := PlainTextAnswer("准备工作包括：[ID:0]")
	if gotId != "准备工作包括：[ID:0]" {
		t.Fatalf("gotId=%q", gotId)
	}
}
