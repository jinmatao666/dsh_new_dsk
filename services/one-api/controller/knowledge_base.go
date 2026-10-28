package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
	"gorm.io/gorm"
)

const maxKnowledgeUploadBytes = 20 << 20

type knowledgeGrantInput struct {
	SubjectType string `json:"subject_type"`
	SubjectId   int    `json:"subject_id"`
}

type createKnowledgeBaseInput struct {
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Kind        string                `json:"kind"`
	Tags        string                `json:"tags"`
	CategoryId  int                   `json:"category_id"`
	Grants      []knowledgeGrantInput `json:"grants"`
}

func validKnowledgeKind(kind string) bool {
	return kind == model.KnowledgeBasePersonal || kind == model.KnowledgeBaseShared || kind == model.KnowledgeBaseCommon
}

func knowledgeClient(c *gin.Context) (*ragflow.Client, bool) {
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": err.Error()})
		return nil, false
	}
	return client, true
}

func knowledgeAdmin(c *gin.Context) bool {
	return c.GetBool("knowledge_admin") || c.GetInt("role") >= model.RoleAdminUser
}

// knowledgeBaseDesktopItem is one authorized library with ownership and grant flags.
// Desktop sidebar uses SubscribedByViewer for 订阅知识库; owned auth libraries stay off the
// sidebar and appear only on 知识库广场.
type knowledgeBaseDesktopItem struct {
	model.KnowledgeBase
	OwnedByViewer      bool `json:"owned_by_viewer"`
	SubscribedByViewer bool `json:"subscribed_by_viewer"`
}

// ListKnowledgeBases returns desktop sidebar libraries: grant-scoped for everyone, with
// administrators also receiving every uncategorized personal library. Auth-category libraries
// still require ownership or a grant so they do not fill 订阅知识库 without approval.
// Full workbench catalog stays on /api/knowledge-admin/bases.
func ListKnowledgeBases(c *gin.Context) {
	userId := c.GetInt("id")
	rows, err := model.ListAuthorizedKnowledgeBases(userId)
	if err != nil {
		logger.Errorf(c.Request.Context(), "list authorized knowledge bases: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	if knowledgeAdmin(c) {
		rows, err = model.MergeAdminPersonalKnowledgeBases(rows)
		if err != nil {
			logger.Errorf(c.Request.Context(), "list admin personal knowledge bases: %s", err.Error())
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
			return
		}
	}
	granted, err := model.KnowledgeBaseGrantIDs(userId)
	if err != nil {
		logger.Errorf(c.Request.Context(), "list knowledge grants: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	items := make([]knowledgeBaseDesktopItem, len(rows))
	for i, row := range rows {
		owned := row.OwnerUserId == userId
		_, hasGrant := granted[row.Id]
		items[i] = knowledgeBaseDesktopItem{
			KnowledgeBase:      row,
			OwnedByViewer:      owned,
			SubscribedByViewer: !owned && hasGrant,
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// ListKnowledgeCategories returns workbench categories for the desktop and admin tabs.
func ListKnowledgeCategories(c *gin.Context) {
	rows, err := model.ListKnowledgeCategories()
	if err != nil {
		logger.Errorf(c.Request.Context(), "list knowledge categories: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库分类失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// ListKnowledgePlaza returns marketplace cards for libraries that require a subscription grant.
func ListKnowledgePlaza(c *gin.Context) {
	categoryId, _ := strconv.Atoi(c.DefaultQuery("category_id", "0"))
	keyword := strings.TrimSpace(c.Query("keyword"))
	rows, err := model.ListKnowledgePlaza(c.GetInt("id"), categoryId, keyword)
	if err != nil {
		logger.Errorf(c.Request.Context(), "list knowledge plaza: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库广场失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// GetKnowledgePlazaItem returns one marketplace library card when it is published and auth-required.
func GetKnowledgePlazaItem(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	row, err := model.GetKnowledgePlazaItem(c.GetInt("id"), id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库不存在"})
			return
		}
		logger.Errorf(c.Request.Context(), "get knowledge plaza item: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// ListKnowledgePlazaDocuments returns marketplace document metadata for one plaza library.
// Catalog names and folder paths are visible before subscription; file bytes stay grant-gated.
func ListKnowledgePlazaDocuments(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	if _, err := model.GetKnowledgePlazaItem(c.GetInt("id"), id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库不存在"})
			return
		}
		logger.Errorf(c.Request.Context(), "get knowledge plaza item for documents: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	row, err := model.GetKnowledgeBase(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	writeKnowledgeDocuments(c, row, false)
}

// SubscribeKnowledgeBase opens a pending subscription application for an auth-required category library.
func SubscribeKnowledgeBase(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	row, err := model.ApplyKnowledgeSubscription(c.GetInt("id"), id)
	if err != nil {
		if errors.Is(err, model.ErrKnowledgeSubscriptionInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		if errors.Is(err, model.ErrKnowledgeSubscriptionDuplicate) {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库不存在"})
			return
		}
		logger.Errorf(c.Request.Context(), "subscribe knowledge base: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "提交订阅申请失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// UnsubscribeKnowledgeBase drops the caller's user grant and clears the subscription application.
func UnsubscribeKnowledgeBase(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	err = model.CancelKnowledgeSubscription(c.GetInt("id"), id)
	if err != nil {
		if errors.Is(err, model.ErrKnowledgeSubscriptionInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		if errors.Is(err, model.ErrKnowledgeSubscriptionInactive) {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库不存在"})
			return
		}
		logger.Errorf(c.Request.Context(), "unsubscribe knowledge base: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "取消订阅失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// CreateKnowledgeBase creates RAGFlow first and compensates it when the local transaction fails.
func CreateKnowledgeBase(c *gin.Context) {
	var input createKnowledgeBaseInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库参数无效"})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.Tags = strings.TrimSpace(input.Tags)
	if input.Name == "" || len([]rune(input.Name)) > 128 || len([]rune(input.Description)) > 500 ||
		len([]rune(input.Tags)) > 200 || !validKnowledgeKind(input.Kind) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库名称、描述或类型无效"})
		return
	}
	if input.Kind == model.KnowledgeBaseCommon && !knowledgeAdmin(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "只有管理员可以创建共性知识库"})
		return
	}
	if input.CategoryId < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库分类无效"})
		return
	}
	// Any signed-in workbench user may file a library under a category they can see.
	if input.CategoryId > 0 {
		category, err := model.GetKnowledgeCategory(input.CategoryId)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库分类不存在"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库分类失败"})
			return
		}
		// Workbench tabs copy visibility from the category; keep kind aligned.
		input.Kind = category.Type
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	userId := c.GetInt("id")
	dataset, err := client.CreateDataset(c.Request.Context(),
		fmt.Sprintf("%s-%d-%d", input.Name, userId, time.Now().UnixMilli()), input.Description)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	row := model.KnowledgeBase{Name: input.Name, Description: input.Description, Tags: input.Tags,
		RagflowDatasetId: dataset.Id, OwnerUserId: userId, Kind: input.Kind, Shelf: model.KnowledgeShelfPublished,
		CategoryId: input.CategoryId}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if input.Kind == model.KnowledgeBaseShared {
			for _, grant := range input.Grants {
				if (grant.SubjectType != model.KnowledgeGrantUser && grant.SubjectType != model.KnowledgeGrantDept) ||
					grant.SubjectId <= 0 {
					return fmt.Errorf("授权对象无效")
				}
				if err := tx.Create(&model.KnowledgeBaseGrant{KnowledgeBaseId: row.Id,
					SubjectType: grant.SubjectType, SubjectId: grant.SubjectId}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		_ = client.DeleteDataset(c.Request.Context(), dataset.Id)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存知识库失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// recordKnowledgeUsage best-effort increments visit_count / daily_usage for workbench stats.
func recordKnowledgeUsage(id int) {
	if err := model.RecordKnowledgeBaseUsage(id); err != nil {
		logger.SysError(fmt.Sprintf("record knowledge usage for %d: %s", id, err.Error()))
	}
}

func authorizedKnowledgeBase(c *gin.Context) (*model.KnowledgeBase, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return nil, false
	}
	row, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), id, knowledgeAdmin(c))
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

// ListKnowledgeDocuments proxies document metadata without exposing RAGFlow credentials.
func ListKnowledgeDocuments(c *gin.Context) {
	row, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	recordKnowledgeUsage(row.Id)
	writeKnowledgeDocuments(c, row, false)
}

// UploadKnowledgeDocument enforces the complete upload limit before forwarding the file.
func UploadKnowledgeDocument(c *gin.Context) {
	row, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	uploadKnowledgeDocument(c, row)
}

// ListKnowledgeDocumentChunks returns parsed text for the desktop document viewer.
func ListKnowledgeDocumentChunks(c *gin.Context) {
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	row, ok := authorizedKnowledgeBase(c)
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

// DownloadKnowledgeDocument proxies the original file for an authorized library.
func DownloadKnowledgeDocument(c *gin.Context) {
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	row, ok := authorizedKnowledgeBase(c)
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

// DeleteKnowledgeDocument removes one file from RAGFlow for an authorized library.
func DeleteKnowledgeDocument(c *gin.Context) {
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	row, ok := authorizedKnowledgeBase(c)
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
	if err := model.DB.Where("knowledge_base_id = ? AND document_id = ?", row.Id, documentId).
		Delete(&model.KnowledgeDocumentNote{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "文件已从知识库移除，但摘要清理失败"})
		return
	}
	_ = model.DeleteKnowledgeDocumentPath(row.Id, documentId)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已删除文件"})
}

type transferKnowledgeDocumentInput struct {
	TargetKnowledgeBaseId int    `json:"target_knowledge_base_id"`
	ConflictPolicy        string `json:"conflict_policy"`
}

// CopyKnowledgeDocument uploads a source file into another personal or shared library.
func CopyKnowledgeDocument(c *gin.Context) {
	transferKnowledgeDocument(c, false)
}

// MoveKnowledgeDocument copies a source file into another personal or shared library, then deletes the source.
func MoveKnowledgeDocument(c *gin.Context) {
	transferKnowledgeDocument(c, true)
}

func transferKnowledgeDocument(c *gin.Context, removeSource bool) {
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	var input transferKnowledgeDocumentInput
	if err := c.ShouldBindJSON(&input); err != nil || input.TargetKnowledgeBaseId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "目标知识库无效"})
		return
	}
	input.ConflictPolicy = strings.TrimSpace(input.ConflictPolicy)
	if input.ConflictPolicy != "" && input.ConflictPolicy != "keep" && input.ConflictPolicy != "replace" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "同名处理方式无效"})
		return
	}
	source, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	if input.TargetKnowledgeBaseId == source.Id {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "不能复制或移动到当前知识库"})
		return
	}
	target, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), input.TargetKnowledgeBaseId, knowledgeAdmin(c))
	if err != nil {
		status := http.StatusInternalServerError
		message := "读取目标知识库失败"
		if err == gorm.ErrRecordNotFound {
			status, message = http.StatusForbidden, "无权访问目标知识库"
		}
		c.JSON(status, gin.H{"success": false, "message": message})
		return
	}
	if target.Kind != model.KnowledgeBasePersonal && target.Kind != model.KnowledgeBaseShared {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "只能复制或移动到个人或共享知识库"})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	documents, err := client.ListDocuments(c.Request.Context(), source.RagflowDatasetId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	var sourceDocument *ragflow.Document
	for i := range documents {
		if documents[i].Id == documentId {
			sourceDocument = &documents[i]
			break
		}
	}
	if sourceDocument == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "源文件不存在"})
		return
	}
	filename := path.Base(strings.TrimSpace(sourceDocument.Name))
	if filename == "" || filename == "." || filename == ".." {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "源文件名称无效"})
		return
	}
	targetDocuments, err := client.ListDocuments(c.Request.Context(), target.RagflowDatasetId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	conflicts := documentsWithName(targetDocuments, filename)
	if len(conflicts) > 0 && input.ConflictPolicy == "" {
		names := make([]string, 0, len(conflicts))
		for _, document := range conflicts {
			names = append(names, document.Name)
		}
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"message": "目标知识库存在同名文件",
			"data":    gin.H{"conflicts": names},
		})
		return
	}
	uploadName := filename
	if len(conflicts) > 0 && input.ConflictPolicy == "replace" {
		ids := knowledgeDocumentIDs(conflicts)
		if err := client.DeleteDocuments(c.Request.Context(), target.RagflowDatasetId, ids); err != nil && !remoteKnowledgeMissing(err) {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := model.DB.Where("knowledge_base_id = ? AND document_id IN ?", target.Id, ids).
			Delete(&model.KnowledgeDocumentNote{}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "清理目标同名摘要失败"})
			return
		}
		_ = model.DB.Where("knowledge_base_id = ? AND document_id IN ?", target.Id, ids).
			Delete(&model.KnowledgeDocumentPath{}).Error
	} else if len(conflicts) > 0 && input.ConflictPolicy == "keep" {
		uploadName = uniqueKnowledgeDocumentName(filename, targetDocuments)
	}
	_, body, err := client.DownloadDocument(c.Request.Context(), source.RagflowDatasetId, documentId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	sourcePaths, _ := model.ListKnowledgeDocumentPaths(source.Id)
	relativePath := sourcePaths[documentId]
	parentPath := ""
	if relativePath != "" {
		parent, _ := ragflow.SplitDocumentUploadPath(relativePath, "")
		parentPath = parent
		if parent != "" {
			relativePath = parent + "/" + uploadName
		} else {
			relativePath = uploadName
		}
	}
	uploaded, err := client.UploadDocument(c.Request.Context(), target.RagflowDatasetId, uploadName, bytes.NewReader(body), parentPath)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	if relativePath != "" {
		for index := range uploaded {
			if uploaded[index].Id == "" {
				continue
			}
			uploaded[index].Location = relativePath
			_ = model.SaveKnowledgeDocumentPath(target.Id, uploaded[index].Id, relativePath)
		}
	}
	startKnowledgeDocumentParse(client, target.RagflowDatasetId, knowledgeDocumentIDs(uploaded))
	if removeSource {
		if err := client.DeleteDocuments(c.Request.Context(), source.RagflowDatasetId, []string{documentId}); err != nil && !remoteKnowledgeMissing(err) {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "已复制到目标知识库，但删除源文件失败：" + err.Error()})
			return
		}
		if err := model.DB.Where("knowledge_base_id = ? AND document_id = ?", source.Id, documentId).
			Delete(&model.KnowledgeDocumentNote{}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "源文件已删除，但摘要清理失败"})
			return
		}
		_ = model.DeleteKnowledgeDocumentPath(source.Id, documentId)
	}
	message := "已复制文件"
	if removeSource {
		message = "已移动文件"
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": message, "data": uploaded})
}

func documentsWithName(documents []ragflow.Document, name string) []ragflow.Document {
	matched := make([]ragflow.Document, 0)
	for _, document := range documents {
		if document.Name == name {
			matched = append(matched, document)
		}
	}
	return matched
}

func uniqueKnowledgeDocumentName(name string, existing []ragflow.Document) string {
	used := make(map[string]struct{}, len(existing))
	for _, document := range existing {
		used[document.Name] = struct{}{}
	}
	if _, ok := used[name]; !ok {
		return name
	}
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for index := 1; index < 1000; index++ {
		candidate := fmt.Sprintf("%s (%d)%s", base, index, ext)
		if _, ok := used[candidate]; !ok {
			return candidate
		}
	}
	return fmt.Sprintf("%s (%d)%s", base, time.Now().UnixMilli(), ext)
}

func writeKnowledgeDocuments(c *gin.Context, row *model.KnowledgeBase, includeSummary bool) {
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	documents, err := client.ListDocuments(c.Request.Context(), row.RagflowDatasetId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	applyKnowledgeDocumentPaths(row.Id, documents)
	if !includeSummary {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": documents})
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
	c.JSON(http.StatusOK, gin.H{"success": true, "data": listed})
}

func applyKnowledgeDocumentPaths(baseId int, documents []ragflow.Document) {
	paths, err := model.ListKnowledgeDocumentPaths(baseId)
	if err != nil || len(paths) == 0 {
		return
	}
	for index := range documents {
		if path := paths[documents[index].Id]; path != "" {
			documents[index].Location = path
		}
	}
}

func uploadKnowledgeDocument(c *gin.Context, row *model.KnowledgeBase) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxKnowledgeUploadBytes)
	header, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请选择不超过 20MB 的文件"})
		return
	}
	source, err := header.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法读取上传文件"})
		return
	}
	defer source.Close()
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	parentPath := strings.TrimSpace(c.PostForm("parent_path"))
	parent, base := ragflow.SplitDocumentUploadPath(header.Filename, parentPath)
	documents, err := client.UploadDocument(c.Request.Context(), row.RagflowDatasetId, header.Filename, source, parentPath)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	if parent != "" {
		relative := parent + "/" + base
		for index := range documents {
			if documents[index].Id == "" {
				continue
			}
			documents[index].Location = relative
			if saveErr := model.SaveKnowledgeDocumentPath(row.Id, documents[index].Id, relative); saveErr != nil {
				logger.Errorf(c.Request.Context(), "save knowledge document path: %s", saveErr.Error())
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": documents})
	startKnowledgeDocumentParse(client, row.RagflowDatasetId, knowledgeDocumentIDs(documents))
}

func knowledgeDocumentIDs(documents []ragflow.Document) []string {
	ids := make([]string, 0, len(documents))
	for _, document := range documents {
		if document.Id != "" {
			ids = append(ids, document.Id)
		}
	}
	return ids
}

// startKnowledgeDocumentParse kicks off RAGFlow chunking without blocking the upload response.
func startKnowledgeDocumentParse(client *ragflow.Client, datasetId string, documentIds []string) {
	if client == nil || datasetId == "" || len(documentIds) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		if err := client.ParseDocuments(ctx, datasetId, documentIds); err != nil {
			logger.SysErrorf("knowledge document parse failed for dataset %s: %s", datasetId, err.Error())
		}
	}()
}

type createKnowledgeConversationInput struct {
	KnowledgeBaseId int    `json:"knowledge_base_id"`
	Model           string `json:"model"`
}

// CreateKnowledgeConversation gives every conversation an isolated assistant and session.
func CreateKnowledgeConversation(c *gin.Context) {
	var input createKnowledgeConversationInput
	if err := c.ShouldBindJSON(&input); err != nil || len([]rune(input.Model)) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "对话参数无效"})
		return
	}
	base, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), input.KnowledgeBaseId, knowledgeAdmin(c))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权使用该知识库"})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	name := fmt.Sprintf("knowledge-%d-%d", c.GetInt("id"), time.Now().UnixMilli())
	chat, err := client.CreateChat(c.Request.Context(), name, base.RagflowDatasetId, input.Model)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	session, err := client.CreateSession(c.Request.Context(), chat.Id, name)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	row := model.KnowledgeConversation{UserId: c.GetInt("id"), KnowledgeBaseId: base.Id,
		RagflowChatId: chat.Id, RagflowSessionId: session.Id, Model: input.Model}
	if err := model.DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存对话失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// UpdateKnowledgeConversation changes the assistant before publishing the local selection.
func UpdateKnowledgeConversation(c *gin.Context) {
	conversationId, err := strconv.Atoi(c.Param("conversationId"))
	var input createKnowledgeConversationInput
	if err != nil || c.ShouldBindJSON(&input) != nil || len([]rune(input.Model)) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "对话参数无效"})
		return
	}
	var conversation model.KnowledgeConversation
	if err := model.DB.Where("id = ? AND user_id = ?", conversationId, c.GetInt("id")).First(&conversation).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权访问该对话"})
		return
	}
	base, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), input.KnowledgeBaseId, knowledgeAdmin(c))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权使用该知识库"})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	if err := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, input.Model); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	conversation.KnowledgeBaseId, conversation.Model = base.Id, input.Model
	if err := model.DB.Model(&conversation).Updates(map[string]interface{}{
		"knowledge_base_id": base.Id, "model": input.Model,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存对话设置失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": conversation})
}

type knowledgeCompletionInput struct {
	Question   string `json:"question"`
	Model      string `json:"model"`
	Stream     bool   `json:"stream"`
	DocumentId string `json:"document_id"`
}

func parseKnowledgeQuestion(c *gin.Context) (knowledgeCompletionInput, bool) {
	var input knowledgeCompletionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "问题无效"})
		return input, false
	}
	input.Question = strings.TrimSpace(input.Question)
	input.Model = strings.TrimSpace(input.Model)
	input.DocumentId = strings.TrimSpace(input.DocumentId)
	if len([]rune(input.Model)) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "模型名称无效"})
		return input, false
	}
	if len([]rune(input.DocumentId)) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文档编号无效"})
		return input, false
	}
	if input.Question == "" || len([]rune(input.Question)) > 8000 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "问题不能为空且不能超过 8000 字"})
		return input, false
	}
	return input, true
}

func recreateKnowledgeConversation(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, userId int, modelName string, existing *model.KnowledgeConversation) (model.KnowledgeConversation, bool) {
	name := fmt.Sprintf("knowledge-%d-%d", userId, time.Now().UnixMilli())
	chat, createErr := client.CreateChat(c.Request.Context(), name, base.RagflowDatasetId, modelName)
	if createErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": createErr.Error()})
		return model.KnowledgeConversation{}, false
	}
	session, sessionErr := client.CreateSession(c.Request.Context(), chat.Id, name)
	if sessionErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": sessionErr.Error()})
		return model.KnowledgeConversation{}, false
	}
	if existing != nil && existing.Id > 0 {
		existing.RagflowChatId = chat.Id
		existing.RagflowSessionId = session.Id
		existing.Model = modelName
		existing.KnowledgeBaseId = base.Id
		if saveErr := model.DB.Model(existing).Updates(map[string]interface{}{
			"ragflow_chat_id": chat.Id, "ragflow_session_id": session.Id, "model": modelName, "knowledge_base_id": base.Id,
		}).Error; saveErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存对话失败"})
			return model.KnowledgeConversation{}, false
		}
		return *existing, true
	}
	conversation := model.KnowledgeConversation{UserId: userId, KnowledgeBaseId: base.Id,
		RagflowChatId: chat.Id, RagflowSessionId: session.Id, Model: modelName}
	if saveErr := model.DB.Create(&conversation).Error; saveErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存对话失败"})
		return model.KnowledgeConversation{}, false
	}
	return conversation, true
}

func answerKnowledgeConversation(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, conversation model.KnowledgeConversation, question string, stream bool, docIds ...string) {
	// Refresh the assistant prompt so older chats also emit citation markers.
	if err := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, conversation.Model); err != nil &&
		!ragflow.ChatOwnershipLost(err) {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	if stream {
		answerKnowledgeConversationStream(c, client, base, conversation, question, docIds...)
		return
	}
	completion, err := completeWithRecovery(c, client, base, conversation, question, docIds...)
	if err != nil {
		if c.Writer.Written() {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	recommendations, recommendationErr := client.Recommend(c.Request.Context(), question)
	if recommendations == nil {
		recommendations = []string{}
	}
	citations := ragflow.ParseCitations(completion.Reference, completion.Answer)
	data := gin.H{
		"answer": completion.Answer, "reference": completion.Reference,
		"recommendations": recommendations, "citations": citations,
	}
	if recommendationErr != nil {
		data["recommendation_warning"] = recommendationErr.Error()
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func completeWithRecovery(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, conversation model.KnowledgeConversation, question string, docIds ...string) (ragflow.Completion, error) {
	completion, err := client.Complete(c.Request.Context(), conversation.RagflowChatId, conversation.RagflowSessionId, question, docIds...)
	if err != nil && ragflow.ChatOwnershipLost(err) {
		recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation)
		if !ok {
			return ragflow.Completion{}, err
		}
		conversation = recreated
		completion, err = client.Complete(c.Request.Context(), conversation.RagflowChatId, conversation.RagflowSessionId, question, docIds...)
	}
	if err != nil && ragflow.TooManyNestedClauses(err) {
		if updateErr := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, conversation.Model); updateErr != nil {
			if ragflow.ChatOwnershipLost(updateErr) {
				recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation)
				if !ok {
					return ragflow.Completion{}, err
				}
				conversation = recreated
			} else {
				return ragflow.Completion{}, err
			}
		}
		completion, err = client.Complete(c.Request.Context(), conversation.RagflowChatId, conversation.RagflowSessionId, question, docIds...)
	}
	return completion, err
}

func answerKnowledgeConversationStream(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, conversation model.KnowledgeConversation, question string, docIds ...string) {
	flusher, canFlush := c.Writer.(http.Flusher)
	headersStarted := false
	writeEvent := func(payload gin.H) bool {
		if !headersStarted {
			c.Header("Content-Type", "text/event-stream")
			c.Header("Cache-Control", "no-cache")
			c.Header("Connection", "keep-alive")
			c.Status(http.StatusOK)
			headersStarted = true
		}
		data, err := json.Marshal(payload)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(c.Writer, "data: %s\n\n", data); err != nil {
			return false
		}
		if canFlush {
			flusher.Flush()
		}
		return true
	}
	run := func(active model.KnowledgeConversation) error {
		return client.CompleteStream(c.Request.Context(), active.RagflowChatId, active.RagflowSessionId, question,
			func(answer string, reference json.RawMessage, done bool) error {
				if done {
					recommendations, recommendationErr := client.Recommend(c.Request.Context(), question)
					if recommendations == nil {
						recommendations = []string{}
					}
					event := gin.H{
						"answer": answer, "recommendations": recommendations,
						"citations": ragflow.ParseCitations(reference, answer), "done": true,
					}
					if recommendationErr != nil {
						event["recommendation_warning"] = recommendationErr.Error()
					}
					if !writeEvent(event) {
						return errors.New("写入流式响应失败")
					}
					return nil
				}
				if !writeEvent(gin.H{"answer": answer, "done": false}) {
					return errors.New("写入流式响应失败")
				}
				return nil
			}, docIds...)
	}
	err := run(conversation)
	if err != nil && ragflow.ChatOwnershipLost(err) && !headersStarted {
		recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation)
		if !ok {
			return
		}
		conversation = recreated
		err = run(conversation)
	}
	if err != nil && ragflow.TooManyNestedClauses(err) && !headersStarted {
		if updateErr := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, conversation.Model); updateErr != nil {
			if ragflow.ChatOwnershipLost(updateErr) {
				recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation)
				if !ok {
					return
				}
				conversation = recreated
			} else {
				c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
				return
			}
		}
		err = run(conversation)
	}
	if err != nil {
		if headersStarted {
			_ = writeEvent(gin.H{"error": err.Error(), "done": true})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
	}
}

func ensureKnowledgeConversation(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, modelName string) (model.KnowledgeConversation, bool) {
	userId := c.GetInt("id")
	var conversation model.KnowledgeConversation
	err := model.DB.Where("user_id = ? AND knowledge_base_id = ?", userId, base.Id).
		Order("id DESC").First(&conversation).Error
	if err == nil {
		modelToUse := conversation.Model
		if modelName != "" {
			modelToUse = modelName
		}
		// Refresh retrieval caps so older assistants stop hitting Elasticsearch nested-clause limits.
		if updateErr := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, modelToUse); updateErr != nil {
			if ragflow.ChatOwnershipLost(updateErr) {
				return recreateKnowledgeConversation(c, client, base, userId, modelToUse, &conversation)
			}
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": updateErr.Error()})
			return conversation, false
		}
		if modelName != "" && conversation.Model != modelName {
			if saveErr := model.DB.Model(&conversation).Update("model", modelName).Error; saveErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存对话设置失败"})
				return conversation, false
			}
			conversation.Model = modelName
		}
		return conversation, true
	}
	if err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取对话失败"})
		return conversation, false
	}
	return recreateKnowledgeConversation(c, client, base, userId, modelName, nil)
}

// ListKnowledgeConversationMessages returns the caller's saved Q&A turns for one authorized knowledge base.
func ListKnowledgeConversationMessages(c *gin.Context) {
	knowledgeBaseId, err := strconv.Atoi(c.Param("id"))
	if err != nil || knowledgeBaseId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	base, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), knowledgeBaseId, knowledgeAdmin(c))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权使用该知识库"})
		return
	}
	var conversation model.KnowledgeConversation
	err = model.DB.Where("user_id = ? AND knowledge_base_id = ?", c.GetInt("id"), base.Id).
		Order("id DESC").First(&conversation).Error
	if err == gorm.ErrRecordNotFound {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []ragflow.SessionMessage{}})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取对话失败"})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	messages, listErr := client.ListSessionMessages(c.Request.Context(), conversation.RagflowChatId, conversation.RagflowSessionId)
	if listErr != nil {
		if ragflow.ChatOwnershipLost(listErr) {
			c.JSON(http.StatusOK, gin.H{"success": true, "data": []ragflow.SessionMessage{}})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": listErr.Error()})
		return
	}
	if messages == nil {
		messages = []ragflow.SessionMessage{}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": messages})
}

// ClearKnowledgeConversationMessages replaces the caller's session so earlier turns are no longer loaded.
func ClearKnowledgeConversationMessages(c *gin.Context) {
	knowledgeBaseId, err := strconv.Atoi(c.Param("id"))
	if err != nil || knowledgeBaseId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	base, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), knowledgeBaseId, knowledgeAdmin(c))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权使用该知识库"})
		return
	}
	var conversation model.KnowledgeConversation
	err = model.DB.Where("user_id = ? AND knowledge_base_id = ?", c.GetInt("id"), base.Id).
		Order("id DESC").First(&conversation).Error
	if err == gorm.ErrRecordNotFound {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{}})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取对话失败"})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	name := fmt.Sprintf("knowledge-%d-%d", c.GetInt("id"), time.Now().UnixMilli())
	session, sessionErr := client.CreateSession(c.Request.Context(), conversation.RagflowChatId, name)
	if sessionErr != nil {
		if ragflow.ChatOwnershipLost(sessionErr) {
			if _, recreated := recreateKnowledgeConversation(c, client, base, c.GetInt("id"), conversation.Model, &conversation); !recreated {
				return
			}
			c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{}})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": sessionErr.Error()})
		return
	}
	if session.Id == "" {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "新建对话失败"})
		return
	}
	previous := conversation.RagflowSessionId
	if saveErr := model.DB.Model(&conversation).Update("ragflow_session_id", session.Id).Error; saveErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存对话失败"})
		return
	}
	if previous != "" && previous != session.Id {
		if deleteErr := client.DeleteSession(c.Request.Context(), conversation.RagflowChatId, previous); deleteErr != nil {
			logger.SysErrorf("knowledge session delete failed for chat %s: %s", conversation.RagflowChatId, deleteErr.Error())
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{}})
}

// ChatCompletionsKnowledgeBase answers against the authorized knowledge base through its isolated chat session.
func ChatCompletionsKnowledgeBase(c *gin.Context) {
	knowledgeBaseId, err := strconv.Atoi(c.Param("id"))
	if err != nil || knowledgeBaseId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	input, ok := parseKnowledgeQuestion(c)
	if !ok {
		return
	}
	base, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), knowledgeBaseId, knowledgeAdmin(c))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权使用该知识库"})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	conversation, ok := ensureKnowledgeConversation(c, client, base, input.Model)
	if !ok {
		return
	}
	recordKnowledgeUsage(base.Id)
	answerKnowledgeConversation(c, client, base, conversation, input.Question, input.Stream, input.DocumentId)
}

// CompleteKnowledgeConversation asks RAGFlow and then attempts related-question generation.
func CompleteKnowledgeConversation(c *gin.Context) {
	conversationId, err := strconv.Atoi(c.Param("conversationId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "对话编号无效"})
		return
	}
	input, ok := parseKnowledgeQuestion(c)
	if !ok {
		return
	}
	var conversation model.KnowledgeConversation
	if err := model.DB.Where("id = ? AND user_id = ?", conversationId, c.GetInt("id")).First(&conversation).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权访问该对话"})
		return
	}
	base, err := model.GetAuthorizedKnowledgeBase(c.GetInt("id"), conversation.KnowledgeBaseId, knowledgeAdmin(c))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权使用该知识库"})
		return
	}
	recordKnowledgeUsage(base.Id)
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	answerKnowledgeConversation(c, client, base, conversation, input.Question, input.Stream, input.DocumentId)
}
