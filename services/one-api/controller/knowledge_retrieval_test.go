package controller

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
)

func TestRetrieveKnowledgeBasesRejectsInvalidInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{
		`not json`,
		`{"knowledge_base_ids":[1],"question":"  ","page_size":8,"similarity_threshold":0.2}`,
		`{"knowledge_base_ids":[],"question":"q","page_size":8,"similarity_threshold":0.2}`,
		`{"knowledge_base_ids":[0],"question":"q","page_size":8,"similarity_threshold":0.2}`,
		`{"knowledge_base_ids":[1],"question":"q","page_size":0,"similarity_threshold":0.2}`,
		`{"knowledge_base_ids":[1],"question":"q","page_size":31,"similarity_threshold":0.2}`,
		`{"knowledge_base_ids":[1],"question":"q","page_size":8}`,
		`{"knowledge_base_ids":[1],"question":"q","page_size":8,"similarity_threshold":1.5}`,
		`{"knowledge_base_ids":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],"question":"q","page_size":8,"similarity_threshold":0.2}`,
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/knowledge-bases/retrieval", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		RetrieveKnowledgeBases(c)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("body=%s status=%d response=%s", body, recorder.Code, recorder.Body.String())
		}
	}
}

func TestRetrievalChunksKeepsRequestedDatasetsAndNamesLibraries(t *testing.T) {
	bases := map[string]*model.KnowledgeBase{
		"ds-a": {Id: 3, Name: "制度库"},
		"ds-b": {Id: 7, Name: "课程库"},
	}
	chunks := retrievalChunks([]ragflow.RetrievedChunk{
		{Content: "第一条", DocumentId: "doc-1", DocumentName: "a.pdf", KbId: "ds-a", Similarity: 0.9},
		{Content: "第二条", DocumentId: "doc-2", DocumentName: "b.pdf", DatasetId: "ds-b", Similarity: 0.8},
		{Content: "越权", DocumentId: "doc-3", KbId: "ds-other"},
		{Content: "   ", DocumentId: "doc-4", KbId: "ds-a"},
	}, bases)
	if len(chunks) != 2 {
		t.Fatalf("chunks=%+v", chunks)
	}
	if chunks[0].KnowledgeBaseId != 3 || chunks[0].KnowledgeBaseName != "制度库" || chunks[0].DocumentName != "a.pdf" {
		t.Fatalf("first=%+v", chunks[0])
	}
	if chunks[1].KnowledgeBaseId != 7 || chunks[1].KnowledgeBaseName != "课程库" {
		t.Fatalf("second=%+v", chunks[1])
	}
}

func TestRagflowRetrieveSendsDatasetsAndBounds(t *testing.T) {
	var received map[string]interface{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/retrieval" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &received)
		_, _ = io.WriteString(w, `{"code":0,"data":{"chunks":[{"id":"c1","content":"正文","document_id":"d1","document_keyword":"x.pdf","kb_id":"ds-a","similarity":0.5}],"total":1}}`)
	}))
	defer upstream.Close()
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	chunks, err := client.Retrieve(context.Background(), "问题", []string{"ds-a"}, ragflow.RetrievalOptions{PageSize: 5, SimilarityThreshold: 0.3})
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) != 1 || chunks[0].OwnerDatasetId() != "ds-a" || chunks[0].DocumentName != "x.pdf" {
		t.Fatalf("chunks=%+v", chunks)
	}
	if received["question"] != "问题" || received["page_size"] != float64(5) || received["similarity_threshold"] != 0.3 {
		t.Fatalf("received=%v", received)
	}
	ids, _ := received["dataset_ids"].([]interface{})
	if len(ids) != 1 || ids[0] != "ds-a" {
		t.Fatalf("dataset_ids=%v", received["dataset_ids"])
	}
}
