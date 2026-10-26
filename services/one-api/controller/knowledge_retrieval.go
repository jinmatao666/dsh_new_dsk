package controller

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
)

const (
	maxRetrievalKnowledgeBases = 20
	maxRetrievalPageSize       = 30
	maxRetrievalQuestionRunes  = 8000
)

type knowledgeRetrievalInput struct {
	KnowledgeBaseIds    []int    `json:"knowledge_base_ids"`
	Question            string   `json:"question"`
	PageSize            int      `json:"page_size"`
	SimilarityThreshold *float64 `json:"similarity_threshold"`
}

type knowledgeRetrievalChunk struct {
	Content           string  `json:"content"`
	DocumentId        string  `json:"document_id"`
	DocumentName      string  `json:"document_name"`
	KnowledgeBaseId   int     `json:"knowledge_base_id"`
	KnowledgeBaseName string  `json:"knowledge_base_name"`
	Similarity        float64 `json:"similarity"`
}

func parseKnowledgeRetrieval(c *gin.Context) (knowledgeRetrievalInput, bool) {
	var input knowledgeRetrievalInput
	fail := func(message string) (knowledgeRetrievalInput, bool) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": message})
		return input, false
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		return fail("检索参数无效")
	}
	input.Question = strings.TrimSpace(input.Question)
	if input.Question == "" || len([]rune(input.Question)) > maxRetrievalQuestionRunes {
		return fail("问题不能为空且不能超过 8000 字")
	}
	if len(input.KnowledgeBaseIds) == 0 || len(input.KnowledgeBaseIds) > maxRetrievalKnowledgeBases {
		return fail("请选择 1 到 20 个知识库")
	}
	for _, id := range input.KnowledgeBaseIds {
		if id <= 0 {
			return fail("知识库编号无效")
		}
	}
	if input.PageSize < 1 || input.PageSize > maxRetrievalPageSize {
		return fail("检索条数必须在 1 到 30 之间")
	}
	if input.SimilarityThreshold == nil || *input.SimilarityThreshold < 0 || *input.SimilarityThreshold > 1 {
		return fail("相似度阈值必须在 0 到 1 之间")
	}
	return input, true
}

// RetrieveKnowledgeBases returns RAGFlow chunks from authorized libraries so the desktop model can answer with them.
func RetrieveKnowledgeBases(c *gin.Context) {
	input, ok := parseKnowledgeRetrieval(c)
	if !ok {
		return
	}
	userId, admin := c.GetInt("id"), knowledgeAdmin(c)
	byDataset := map[string]*model.KnowledgeBase{}
	datasetIds := make([]string, 0, len(input.KnowledgeBaseIds))
	for _, id := range input.KnowledgeBaseIds {
		base, err := model.GetAuthorizedKnowledgeBase(userId, id, admin)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权使用所选知识库"})
			return
		}
		if _, seen := byDataset[base.RagflowDatasetId]; seen {
			continue
		}
		byDataset[base.RagflowDatasetId] = base
		datasetIds = append(datasetIds, base.RagflowDatasetId)
	}
	for _, base := range byDataset {
		recordKnowledgeUsage(base.Id)
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	chunks, err := client.Retrieve(c.Request.Context(), input.Question, datasetIds, ragflow.RetrievalOptions{
		PageSize:            input.PageSize,
		SimilarityThreshold: *input.SimilarityThreshold,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"chunks": retrievalChunks(chunks, byDataset)}})
}

// retrievalChunks drops chunks from datasets the caller did not request and attaches library names.
func retrievalChunks(chunks []ragflow.RetrievedChunk, byDataset map[string]*model.KnowledgeBase) []knowledgeRetrievalChunk {
	result := make([]knowledgeRetrievalChunk, 0, len(chunks))
	for _, chunk := range chunks {
		base, ok := byDataset[chunk.OwnerDatasetId()]
		if !ok || strings.TrimSpace(chunk.Content) == "" {
			continue
		}
		result = append(result, knowledgeRetrievalChunk{
			Content:           chunk.Content,
			DocumentId:        chunk.DocumentId,
			DocumentName:      chunk.DocumentName,
			KnowledgeBaseId:   base.Id,
			KnowledgeBaseName: base.Name,
			Similarity:        chunk.Similarity,
		})
	}
	return result
}
