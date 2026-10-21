package controller

import (
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
	"gorm.io/gorm"
)

type managedKnowledgeDocument struct {
	ragflow.Document
	Summary string `json:"summary"`
}

// CreateManagedKnowledgeBase allows the workbench to create a common library.
func CreateManagedKnowledgeBase(c *gin.Context) {
	c.Set("knowledge_admin", true)
	CreateKnowledgeBase(c)
}

// ListManagedKnowledgeBases returns the full catalog, including offline and common libraries.
func ListManagedKnowledgeBases(c *gin.Context) {
	rows, err := model.ListManagedKnowledgeBases()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

func managedKnowledgeBase(c *gin.Context) (*model.KnowledgeBase, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return nil, false
	}
	row, err := model.GetKnowledgeBase(id)
	if err != nil {
		status := http.StatusInternalServerError
		message := "读取知识库失败"
		if err == gorm.ErrRecordNotFound {
			status, message = http.StatusNotFound, "知识库不存在"
		}
		c.JSON(status, gin.H{"success": false, "message": message})
		return nil, false
	}
	return row, true
}

func validKnowledgeDocumentID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' && r != '_' {
			return false
		}
	}
	return true
}

func managedDocumentID(c *gin.Context) (string, bool) {
	id := c.Param("documentId")
	if !validKnowledgeDocumentID(id) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件编号无效"})
		return "", false
	}
	return id, true
}

func remoteKnowledgeMissing(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "404") || strings.Contains(text, "not found") || strings.Contains(err.Error(), "不存在")
}

type updateKnowledgeShelfInput struct {
	Shelf string `json:"shelf"`
}

// UpdateManagedKnowledgeBase changes whether desktop retrieval can see the library.
func UpdateManagedKnowledgeBase(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	var input updateKnowledgeShelfInput
	if c.ShouldBindJSON(&input) != nil ||
		(input.Shelf != model.KnowledgeShelfPublished && input.Shelf != model.KnowledgeShelfOffline) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "上架状态无效"})
		return
	}
	if err := model.DB.Model(row).Update("shelf", input.Shelf).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存上架状态失败"})
		return
	}
	row.Shelf = input.Shelf
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// DeleteManagedKnowledgeBase removes the RAGFlow dataset and then the local records.
func DeleteManagedKnowledgeBase(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	if err := client.DeleteDataset(c.Request.Context(), row.RagflowDatasetId); err != nil && !remoteKnowledgeMissing(err) {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.DeleteKnowledgeBaseRecords(row.Id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "删除知识库失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已删除知识库"})
}

// ListManagedKnowledgeDocuments returns one page of file metadata plus locally stored summaries.
// Query: page (default 1), page_size (default 20, max 100), keywords (optional title match).
func ListManagedKnowledgeDocuments(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	keywords := strings.TrimSpace(c.Query("keywords"))
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	documents, total, err := client.ListDocumentsPage(c.Request.Context(), row.RagflowDatasetId, page, pageSize, keywords)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	summaries, err := model.ListKnowledgeDocumentSummaries(row.Id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取文档摘要失败"})
		return
	}
	listed := make([]managedKnowledgeDocument, 0, len(documents))
	for _, document := range documents {
		listed = append(listed, managedKnowledgeDocument{Document: document, Summary: summaries[document.Id]})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":     listed,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// UploadManagedKnowledgeDocument accepts a file for any library in the catalog.
func UploadManagedKnowledgeDocument(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	uploadKnowledgeDocument(c, row)
}

// DeleteManagedKnowledgeDocument removes one file from RAGFlow.
func DeleteManagedKnowledgeDocument(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	if err := client.DeleteDocuments(c.Request.Context(), row.RagflowDatasetId, []string{documentId}); err != nil && !remoteKnowledgeMissing(err) {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.DB.Where("knowledge_base_id = ? AND document_id = ?", row.Id, documentId).Delete(&model.KnowledgeDocumentNote{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "文件已从知识库移除，但摘要清理失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已删除文件"})
}

// ParseManagedKnowledgeDocument starts RAGFlow chunking for one file.
func ParseManagedKnowledgeDocument(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	if err := client.ParseDocuments(c.Request.Context(), row.RagflowDatasetId, []string{documentId}); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已提交切片"})
}

// DownloadManagedKnowledgeDocument proxies the original file bytes.
func DownloadManagedKnowledgeDocument(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	contentType, body, err := client.DownloadDocument(c.Request.Context(), row.RagflowDatasetId, documentId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.Data(http.StatusOK, contentType, body)
}

// ListManagedKnowledgeChunks returns parsed text for the browse dialog.
func ListManagedKnowledgeChunks(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	chunks, err := client.ListChunks(c.Request.Context(), row.RagflowDatasetId, documentId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": chunks})
}

type knowledgeSummaryInput struct {
	Summary string `json:"summary"`
}

// UpdateManagedKnowledgeSummary saves the summary shown in the file list.
func UpdateManagedKnowledgeSummary(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	var input knowledgeSummaryInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "摘要无效"})
		return
	}
	summary := strings.TrimSpace(input.Summary)
	if len([]rune(summary)) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "摘要不能超过 500 字"})
		return
	}
	if err := model.SaveKnowledgeDocumentSummary(row.Id, documentId, summary); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存摘要失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"summary": summary}})
}
