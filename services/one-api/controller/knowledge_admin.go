package controller

import (
	"errors"
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

type createKnowledgeCategoryInput struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	RequireAuth bool   `json:"require_auth"`
}

type reviewKnowledgeSubscriptionInput struct {
	Decision string `json:"decision"`
}

// ListManagedKnowledgeSubscriptionApplications returns a paginated audit queue for subscription requests.
func ListManagedKnowledgeSubscriptionApplications(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	status := strings.TrimSpace(c.DefaultQuery("status", model.KnowledgeSubscriptionPending))
	if status != "" && status != model.KnowledgeSubscriptionPending &&
		status != model.KnowledgeSubscriptionApproved && status != model.KnowledgeSubscriptionRejected {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "审核状态无效"})
		return
	}
	rows, total, err := model.ListKnowledgeSubscriptionApplications(status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取订阅审核列表失败"})
		return
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":     rows,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// ReviewManagedKnowledgeSubscription approves or rejects one pending subscription application.
func ReviewManagedKnowledgeSubscription(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "申请编号无效"})
		return
	}
	var input reviewKnowledgeSubscriptionInput
	if c.ShouldBindJSON(&input) != nil ||
		(input.Decision != "approve" && input.Decision != "reject") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "审核决定无效"})
		return
	}
	row, err := model.ReviewKnowledgeSubscription(id, c.GetInt("id"), input.Decision == "approve")
	if err != nil {
		if errors.Is(err, model.ErrKnowledgeSubscriptionNotPending) {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "订阅申请不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存审核结果失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// CreateManagedKnowledgeCategory adds a workbench tab owned by the caller.
func CreateManagedKnowledgeCategory(c *gin.Context) {
	var input createKnowledgeCategoryInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库分类参数无效"})
		return
	}
	row := model.KnowledgeCategory{
		Name: input.Name, Type: input.Type, RequireAuth: input.RequireAuth,
		OwnerUserId: c.GetInt("id"),
	}
	if err := model.SaveKnowledgeCategory(&row); err != nil {
		if errors.Is(err, model.ErrKnowledgeCategoryDuplicate) || errors.Is(err, model.ErrKnowledgeCategoryInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存知识库分类失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

func managedKnowledgeCategoryID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库分类编号无效"})
		return 0, false
	}
	return id, true
}

// UpdateManagedKnowledgeCategory renames or retunes an existing workbench category tab.
func UpdateManagedKnowledgeCategory(c *gin.Context) {
	id, ok := managedKnowledgeCategoryID(c)
	if !ok {
		return
	}
	existing, err := model.GetKnowledgeCategory(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库分类不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库分类失败"})
		return
	}
	root := c.GetInt("role") >= model.RoleRootUser
	if !model.CanManageKnowledgeCategory(existing, c.GetInt("id"), root) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "只能管理自己创建的知识库分类"})
		return
	}
	var input createKnowledgeCategoryInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库分类参数无效"})
		return
	}
	row := model.KnowledgeCategory{Id: id, Name: input.Name, Type: input.Type, RequireAuth: input.RequireAuth, OwnerUserId: existing.OwnerUserId}
	if err := model.UpdateKnowledgeCategory(&row); err != nil {
		if errors.Is(err, model.ErrKnowledgeCategoryDuplicate) || errors.Is(err, model.ErrKnowledgeCategoryInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库分类不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存知识库分类失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// DeleteManagedKnowledgeCategory removes a workbench category and every library filed under it.
func DeleteManagedKnowledgeCategory(c *gin.Context) {
	id, ok := managedKnowledgeCategoryID(c)
	if !ok {
		return
	}
	existing, err := model.GetKnowledgeCategory(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库分类不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库分类失败"})
		return
	}
	root := c.GetInt("role") >= model.RoleRootUser
	if !model.CanManageKnowledgeCategory(existing, c.GetInt("id"), root) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "只能管理自己创建的知识库分类"})
		return
	}
	libraries, err := model.ListKnowledgeBasesByCategory(id)
	if err != nil {
		if errors.Is(err, model.ErrKnowledgeCategoryInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取分类知识库失败"})
		return
	}
	if len(libraries) > 0 {
		client, ok := knowledgeClient(c)
		if !ok {
			return
		}
		for _, library := range libraries {
			if err := client.DeleteDataset(c.Request.Context(), library.RagflowDatasetId); err != nil && !remoteKnowledgeMissing(err) {
				c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
				return
			}
			if err := model.DeleteKnowledgeBaseRecords(library.Id); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "删除分类下知识库失败"})
				return
			}
		}
	}
	if err := model.DeleteKnowledgeCategory(id); err != nil {
		if errors.Is(err, model.ErrKnowledgeCategoryInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库分类不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "删除知识库分类失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// CreateManagedKnowledgeBase allows the workbench to create a common library.
func CreateManagedKnowledgeBase(c *gin.Context) {
	c.Set("knowledge_admin", true)
	CreateKnowledgeBase(c)
}

// ListManagedRagflowDatasets returns RAGFlow datasets not yet bound to a local library.
// Available to every signed-in user. OneAPI calls GET {RAGFLOW_BASE_URL}/api/v1/datasets with the configured API key.
func ListManagedRagflowDatasets(c *gin.Context) {
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	datasets, err := client.ListAllDatasets(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	boundIds, err := model.ListBoundRagflowDatasetIds()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	bound := make(map[string]struct{}, len(boundIds))
	for _, id := range boundIds {
		bound[id] = struct{}{}
	}
	available := make([]ragflow.Dataset, 0, len(datasets))
	for _, dataset := range datasets {
		if _, used := bound[dataset.Id]; used {
			continue
		}
		available = append(available, dataset)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": available})
}

// ListManagedKnowledgeBases returns the full catalog, including offline and common libraries.
// Only the root operator may load the unfiltered workbench catalog.
func ListManagedKnowledgeBases(c *gin.Context) {
	if c.GetInt("role") < model.RoleRootUser {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "仅超级管理员可查看全部知识库"})
		return
	}
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
	root := c.GetInt("role") >= model.RoleRootUser
	row, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), id, root)
	if err != nil {
		status := http.StatusInternalServerError
		message := "读取知识库失败"
		if err == gorm.ErrRecordNotFound {
			status, message = http.StatusForbidden, "无权访问该知识库"
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

type updateManagedKnowledgeBaseInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Tags        string `json:"tags"`
	Shelf       string `json:"shelf"`
	// Cover is present when the workbench edit dialog sends a replacement or an empty clear.
	// A missing field leaves the stored cover unchanged.
	Cover *string `json:"cover"`
}

// UpdateManagedKnowledgeBase saves workbench metadata and optional shelf visibility.
func UpdateManagedKnowledgeBase(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	var input updateManagedKnowledgeBaseInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库参数无效"})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.Tags = strings.TrimSpace(input.Tags)
	input.Shelf = strings.TrimSpace(input.Shelf)
	updates := map[string]interface{}{}
	if input.Name != "" {
		if len([]rune(input.Name)) > 128 || len([]rune(input.Description)) > 500 || len([]rune(input.Tags)) > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库名称、描述或标签无效"})
			return
		}
		updates["name"] = input.Name
		updates["description"] = input.Description
		updates["tags"] = input.Tags
	}
	if input.Shelf != "" {
		if input.Shelf != model.KnowledgeShelfPublished && input.Shelf != model.KnowledgeShelfOffline {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "上架状态无效"})
			return
		}
		updates["shelf"] = input.Shelf
	}
	if input.Cover != nil {
		normalizedCover, coverErr := model.NormalizeKnowledgeCover(*input.Cover)
		if coverErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": coverErr.Error()})
			return
		}
		updates["cover"] = normalizedCover
	}
	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库参数无效"})
		return
	}
	if err := model.DB.Model(&model.KnowledgeBase{}).Where("id = ?", row.Id).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存知识库失败"})
		return
	}
	updated, err := model.GetKnowledgeBase(row.Id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": updated})
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
	_ = model.DeleteKnowledgeDocumentCreators(row.Id, []string{documentId})
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

// GetManagedKnowledgeChunkViewer returns the RAGFlow UI URL for one file's slices.
func GetManagedKnowledgeChunkViewer(c *gin.Context) {
	row, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	viewerURL, err := ragflow.ChunkViewerURL(row.RagflowDatasetId, documentId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": viewerURL}})
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
