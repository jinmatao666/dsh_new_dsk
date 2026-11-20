package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxKnowledgeUploadBytes = 20 << 20

type knowledgeGrantInput struct {
	SubjectType string `json:"subject_type"`
	SubjectId   int    `json:"subject_id"`
}

type createKnowledgeBaseInput struct {
	OwnerUserId      int                   `json:"owner_user_id"`
	Name             string                `json:"name"`
	Description      string                `json:"description"`
	Kind             string                `json:"kind"`
	Tags             string                `json:"tags"`
	CategoryId       int                   `json:"category_id"`
	Cover            string                `json:"cover"`
	RagflowDatasetId string                `json:"ragflow_dataset_id"`
	Grants           []knowledgeGrantInput `json:"grants"`
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

// knowledgeAdmin is true for the root catalog operator (or an explicit workbench create flag).
// Ordinary administrators (role 10) are not knowledge catalog admins: they only see self and
// same-organization personal libraries, plus categories they own or may open.
func knowledgeAdmin(c *gin.Context) bool {
	return c.GetBool("knowledge_admin") || c.GetInt("role") >= model.RoleRootUser
}

// knowledgeBaseDesktopItem is one authorized library with ownership and grant flags.
// Desktop sidebar uses SubscribedByViewer for 订阅知识库; owned auth libraries stay off the
// sidebar and appear only on 知识库广场. DocumentCount and DocumentBytes are the RAGFlow dataset
// totals, or 0 when RAGFlow is unconfigured or the request fails. OwnerUsername and
// SubscriberCount carry the same maintainer and subscription figures as the plaza card.
type knowledgeBaseDesktopItem struct {
	model.KnowledgeBase
	OperationsEdition  bool   `json:"operations_edition"`
	OwnedByViewer      bool   `json:"owned_by_viewer"`
	SubscribedByViewer bool   `json:"subscribed_by_viewer"`
	DocumentCount      int    `json:"document_count"`
	DocumentBytes      int64  `json:"document_bytes"`
	OwnerUsername      string `json:"owner_username"`
	SubscriberCount    int    `json:"subscriber_count"`
}

// ListKnowledgeBases returns desktop sidebar libraries: grant-scoped for everyone.
// Uncategorized personal libraries are owner-only for every role, including root;
// administrators browse other users' personal libraries only on the workbench catalog
// (/api/knowledge-admin/bases). Category libraries still require ownership or a grant
// (or a public common category) so they do not appear without approval.
func ListKnowledgeBases(c *gin.Context) {
	userId := c.GetInt("id")
	rows, err := model.ListAuthorizedKnowledgeBases(userId)
	if err != nil {
		logger.Errorf(c.Request.Context(), "list authorized knowledge bases: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	granted, err := model.KnowledgeBaseGrantIDs(userId)
	if err != nil {
		logger.Errorf(c.Request.Context(), "list knowledge grants: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
		return
	}
	operations, _ := knowledgePublicationEnabled()
	items := make([]knowledgeBaseDesktopItem, len(rows))
	for i, row := range rows {
		owned := row.OwnerUserId == userId
		_, hasGrant := granted[row.Id]
		items[i] = knowledgeBaseDesktopItem{
			KnowledgeBase:      row,
			OperationsEdition:  operations,
			OwnedByViewer:      owned,
			SubscribedByViewer: !owned && hasGrant,
		}
	}
	fillDesktopCatalogMeta(c.Request.Context(), items)
	fillDesktopDocumentStats(c.Request.Context(), items)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// fillDesktopCatalogMeta sets each sidebar library's maintainer name and subscriber total.
// A failed lookup leaves the fields empty so the sidebar still lists.
func fillDesktopCatalogMeta(ctx context.Context, items []knowledgeBaseDesktopItem) {
	if len(items) == 0 {
		return
	}
	baseIds := make([]int, 0, len(items))
	ownerIds := make([]int, 0, len(items))
	seenOwner := map[int]struct{}{}
	for _, item := range items {
		baseIds = append(baseIds, item.Id)
		if _, ok := seenOwner[item.OwnerUserId]; !ok {
			seenOwner[item.OwnerUserId] = struct{}{}
			ownerIds = append(ownerIds, item.OwnerUserId)
		}
	}
	owners, err := model.KnowledgeUserDisplayNames(ownerIds)
	if err != nil {
		logger.Errorf(ctx, "list knowledge owner names: %s", err.Error())
	}
	subscribers, err := model.KnowledgeSubscriberCounts(baseIds)
	if err != nil {
		logger.Errorf(ctx, "list knowledge subscriber counts: %s", err.Error())
	}
	for i := range items {
		items[i].OwnerUsername = owners[items[i].OwnerUserId]
		items[i].SubscriberCount = subscribers[items[i].Id]
	}
}

// fillDesktopDocumentStats sets each sidebar library's file count and byte size from RAGFlow.
// A missing RAGFlow client or a failed request leaves those figures at zero so the sidebar still lists.
func fillDesktopDocumentStats(ctx context.Context, items []knowledgeBaseDesktopItem) {
	if len(items) == 0 {
		return
	}
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		return
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i := range items {
		datasetId := items[i].RagflowDatasetId
		if datasetId == "" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(index int, datasetId string) {
			defer wg.Done()
			defer func() { <-sem }()
			count, bytes := plazaDatasetStats(ctx, client, datasetId)
			items[index].DocumentCount = count
			items[index].DocumentBytes = bytes
		}(i, datasetId)
	}
	wg.Wait()
}

// ListKnowledgeOrganizationDirectory returns the caller's membership org tree and same-node peers
// for the workbench personal knowledge directory (not the full administrator roster).
func ListKnowledgeOrganizationDirectory(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	directory, err := model.ListKnowledgeOrganizationDirectory(c.GetInt("id"))
	if err != nil {
		logger.Errorf(c.Request.Context(), "list knowledge organization directory: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取组织架构失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": directory})
}

// ListKnowledgeCategories returns workbench category tabs the caller may see.
// Visibility is by category type and ownership (or an accessible library inside), never by tab name.
func ListKnowledgeCategories(c *gin.Context) {
	userId := c.GetInt("id")
	root := c.GetInt("role") >= model.RoleRootUser
	rows, err := model.ListKnowledgeCategoriesForUser(userId, root)
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
	fillPlazaDocumentStats(c.Request.Context(), rows)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// fillPlazaDocumentStats sets file count and byte size from RAGFlow.
// A missing RAGFlow client leaves those fields at zero so the plaza still lists.
func fillPlazaDocumentStats(ctx context.Context, rows []model.KnowledgePlazaItem) {
	if len(rows) == 0 {
		return
	}
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		return
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i := range rows {
		datasetId := rows[i].RagflowDatasetId
		if datasetId == "" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(index int, datasetId string) {
			defer wg.Done()
			defer func() { <-sem }()
			count, bytes := plazaDatasetStats(ctx, client, datasetId)
			rows[index].DocumentCount = count
			rows[index].DocumentBytes = bytes
		}(i, datasetId)
	}
	wg.Wait()
}

func plazaDatasetStats(ctx context.Context, client *ragflow.Client, datasetId string) (int, int64) {
	const pageSize = 100
	const maxPages = 10
	var totalBytes int64
	total := 0
	for page := 1; page <= maxPages; page++ {
		docs, count, err := client.ListDocumentsPage(ctx, datasetId, page, pageSize, "")
		if err != nil {
			return total, totalBytes
		}
		if page == 1 {
			total = count
		}
		for _, doc := range docs {
			totalBytes += doc.Size
		}
		if len(docs) == 0 || page*pageSize >= total {
			break
		}
	}
	return total, totalBytes
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
	filled := []model.KnowledgePlazaItem{*row}
	fillPlazaDocumentStats(c.Request.Context(), filled)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": filled[0]})
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
	if input.OwnerUserId != 0 {
		if !c.GetBool("knowledge_admin") || c.GetInt("role") < model.RoleAdminUser {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "只有管理员可以为人员创建个人知识库"})
			return
		}
		if input.OwnerUserId < 0 || input.Kind != model.KnowledgeBasePersonal || input.CategoryId != 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "仅支持为人员创建个人知识库"})
			return
		}
		var owner model.User
		if err := model.DB.Select("id").First(&owner, input.OwnerUserId).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "目标人员不存在"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取目标人员失败"})
			}
			return
		}
	}
	if input.Name == "" || len([]rune(input.Name)) > 128 || len([]rune(input.Description)) > 500 ||
		len([]rune(input.Tags)) > 200 || !validKnowledgeKind(input.Kind) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库名称、描述或类型无效"})
		return
	}
	normalizedCover, coverErr := model.NormalizeKnowledgeCover(input.Cover)
	if coverErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": coverErr.Error()})
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
	existingDatasetId := strings.TrimSpace(input.RagflowDatasetId)
	if existingDatasetId != "" {
		if len(existingDatasetId) > 64 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
			return
		}
		bound, boundErr := model.KnowledgeBaseBoundToRagflowDataset(existingDatasetId)
		if boundErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取知识库失败"})
			return
		}
		if bound {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "该知识库已关联到管理工作台"})
			return
		}
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	userId := c.GetInt("id")
	if input.OwnerUserId > 0 {
		userId = input.OwnerUserId
	}
	var dataset ragflow.Dataset
	createdRemote := false
	if existingDatasetId != "" {
		var err error
		dataset, err = client.GetDataset(c.Request.Context(), existingDatasetId)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}
	} else {
		var err error
		dataset, err = client.CreateDataset(c.Request.Context(),
			fmt.Sprintf("%s-%d-%d", input.Name, userId, time.Now().UnixMilli()), input.Description)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}
		createdRemote = true
	}
	row := model.KnowledgeBase{Name: input.Name, Description: input.Description, Tags: input.Tags,
		Cover: normalizedCover, RagflowDatasetId: dataset.Id, OwnerUserId: userId, Kind: input.Kind,
		Shelf: model.KnowledgeShelfPublished, CategoryId: input.CategoryId}
	errExistingPersonal := errors.New("该人员已有个人知识库，请刷新后查看")
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if input.OwnerUserId > 0 {
			var owner model.User
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&owner, userId).Error; err != nil {
				return err
			}
			var count int64
			if err := tx.Model(&model.KnowledgeBase{}).Where("owner_user_id = ? AND kind = ? AND COALESCE(category_id, 0) = 0", userId, model.KnowledgeBasePersonal).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errExistingPersonal
			}
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if err := model.RecordKnowledgeActivity(tx, &row, c.GetInt("id"), "create", "personal", "", "", "success"); err != nil {
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
		if createdRemote {
			_ = client.DeleteDataset(c.Request.Context(), dataset.Id)
		}
		if errors.Is(err, errExistingPersonal) {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
			return
		}
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
	if c.Query("refresh") != "1" {
		recordKnowledgeUsage(row.Id)
	}
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

// ParsePersonalKnowledgeDocument starts chunking a document in the caller's own personal library.
func ParsePersonalKnowledgeDocument(c *gin.Context) {
	row, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	if row.Kind != model.KnowledgeBasePersonal || row.CategoryId != 0 || row.OwnerUserId != c.GetInt("id") {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权重新解析该知识库的文件"})
		return
	}
	parseKnowledgeDocument(c, row)
}

type importKnowledgeWebLinksInput struct {
	URLs []string `json:"urls"`
}

const maxKnowledgeWebLinks = 10

// ImportKnowledgeWebLinks crawls up to ten public http(s) pages into an uncategorized personal library.
func ImportKnowledgeWebLinks(c *gin.Context) {
	row, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	if !canWritePublishedKnowledge(c, row) {
		return
	}
	if row.Kind != model.KnowledgeBasePersonal || row.CategoryId != 0 {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "仅个人知识库支持导入网页链接"})
		return
	}
	var input importKnowledgeWebLinksInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数无效"})
		return
	}
	urls, err := normalizeKnowledgeWebLinks(input.URLs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	uploaded := make([]ragflow.Document, 0, len(urls))
	for _, pageURL := range urls {
		documents, uploadErr := client.UploadWebDocument(c.Request.Context(), row.RagflowDatasetId,
			ragflow.WebDocumentName(pageURL), pageURL)
		if uploadErr != nil {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": uploadErr.Error()})
			return
		}
		for index := range documents {
			if documents[index].Id == "" {
				continue
			}
			if saveErr := model.SaveKnowledgeDocumentCreator(row.Id, documents[index].Id, c.GetInt("id")); saveErr != nil {
				logger.Errorf(c.Request.Context(), "save knowledge web document creator: %s", saveErr.Error())
			}
			uploaded = append(uploaded, documents[index])
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": uploaded})
	startKnowledgeDocumentParse(client, row.RagflowDatasetId, knowledgeDocumentIDs(uploaded))
}

func normalizeKnowledgeWebLinks(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, errors.New("请输入网页链接")
	}
	if len(raw) > maxKnowledgeWebLinks {
		return nil, errors.New("一次最多导入 10 条链接")
	}
	seen := make(map[string]struct{}, len(raw))
	urls := make([]string, 0, len(raw))
	for _, item := range raw {
		normalized, err := validateKnowledgeWebLink(item)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		urls = append(urls, normalized)
	}
	if len(urls) == 0 {
		return nil, errors.New("请输入网页链接")
	}
	return urls, nil
}

func validateKnowledgeWebLink(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return "", fmt.Errorf("链接格式无效：%s", strings.TrimSpace(raw))
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") {
		return "", errors.New("不支持本机或内网链接")
	}
	parsed.Fragment = ""
	return parsed.String(), nil
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
	terms, err := model.ReadKnowledgeCreditTerms(row, c.GetInt("id"))
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	if terms != nil && terms.Price.BrowseCents > 0 {
		until, err := model.KnowledgePreviewPaidUntil(c.GetInt("id"), row.Id, documentId)
		if err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
		if !until.After(time.Now()) {
			knowledgeCreditFailure(c, 402, errors.New("请先打开文件预览"))
			return
		}
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
	action := c.Query("action")
	if action != "" && c.Request.Method != http.MethodPost {
		knowledgeCreditFailure(c, 405, errors.New("付费文件操作必须使用 POST"))
		return
	}
	if action != "" && action != "browse" && action != "download" {
		knowledgeCreditFailure(c, 400, errors.New("知识库文件操作无效"))
		return
	}
	terms, err := model.ReadKnowledgeCreditTerms(row, c.GetInt("id"))
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	requestId := ""
	if terms != nil {
		if action == "" && terms.Price.BrowseCents > 0 {
			until, err := model.KnowledgePreviewPaidUntil(c.GetInt("id"), row.Id, documentId)
			if err != nil {
				knowledgeCreditFailure(c, 500, err)
				return
			}
			if !until.After(time.Now()) {
				knowledgeCreditFailure(c, 402, errors.New("请先打开文件预览"))
				return
			}
		}
		if action != "" {
			requestId, err = knowledgeCreditRequestId(c.Query("request_id"))
			if err != nil {
				knowledgeCreditFailure(c, 400, err)
				return
			}
			expected := terms.Price.BrowseCents
			if action == "download" {
				expected = terms.Price.DownloadCents
			}
			if quoted := c.Query("expected_cents"); quoted != "" && quoted != strconv.FormatInt(expected, 10) {
				var receipt model.KnowledgeCreditReceipt
				err := model.DB.Where("user_id = ? AND request_id = ? AND knowledge_base_id = ? AND document_id = ? AND action = ?", c.GetInt("id"), requestId, row.Id, documentId, action).First(&receipt).Error
				if err != nil {
					knowledgeCreditFailure(c, 409, errors.New("知识库单价已变更，请刷新后重试"))
					return
				}
			}
		}
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	if terms != nil && action != "" {
		if err := model.ReserveKnowledgeCredits(c.GetInt("id"), row, terms, action, requestId, documentId); err != nil {
			knowledgeCreditFailure(c, 402, err)
			return
		}
	}
	readyToSettle := false
	defer func() {
		if terms != nil && action != "" && !readyToSettle {
			releaseKnowledgeOperation(c, row.Id, action, requestId, documentId)
		}
	}()
	contentType, body, err := client.DownloadDocument(c.Request.Context(), row.RagflowDatasetId, documentId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	if terms != nil && action != "" {
		if err := c.Request.Context().Err(); err != nil {
			return
		}
		document, err := client.GetDocument(c.Request.Context(), row.RagflowDatasetId, documentId)
		if err != nil {
			knowledgeCreditFailure(c, 502, err)
			return
		}
		documentName := document.Name
		readyToSettle = true

		if _, err := model.SettleKnowledgeCredits(c.GetInt("id"), row, terms, action, requestId, []model.KnowledgeCreditDocument{{Id: documentId, Name: documentName}}, "", ""); err != nil {
			knowledgeCreditFailure(c, 402, err)
			return
		}
	}
	c.Header("Cache-Control", "no-store")
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
	if !canWritePublishedKnowledge(c, row) {
		return
	}
	deleteKnowledgeDocumentWithActivity(c, row, documentId)
}

type transferKnowledgeDocumentInput struct {
	TargetKnowledgeBaseId int    `json:"target_knowledge_base_id"`
	ConflictPolicy        string `json:"conflict_policy"`
}

// CopyKnowledgeDocument uploads a source file into another personal or shared library.
func CopyKnowledgeDocument(c *gin.Context) {
	transferKnowledgeDocument(c, false, false)
}

// MoveKnowledgeDocument copies a source file into another personal or shared library, then deletes the source.
func MoveKnowledgeDocument(c *gin.Context) {
	transferKnowledgeDocument(c, true, false)
}

func transferKnowledgeDocument(c *gin.Context, removeSource, returnToUploader bool) {
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
	var target *model.KnowledgeBase
	var err error
	if returnToUploader {
		if c.GetInt("role") < model.RoleAdminUser {
			c.JSON(403, gin.H{"success": false, "message": "无权转回文件"})
			return
		}
		uploader, uploaderErr := knowledgeReturnUploader(source, documentId)
		if uploaderErr != nil {
			c.JSON(400, gin.H{"success": false, "message": uploaderErr.Error()})
			return
		}
		target, err = model.GetKnowledgeBase(input.TargetKnowledgeBaseId)
		if err == nil && (target.OwnerUserId != uploader || target.Kind != model.KnowledgeBasePersonal || target.CategoryId != 0 || target.PublicationScope != "") {
			c.JSON(403, gin.H{"success": false, "message": "只能转回上传人未发布的个人知识库"})
			return
		}
		input.ConflictPolicy = "keep"
	} else {
		target, err = model.GetAuthorizedKnowledgeBase(c.GetInt("id"), input.TargetKnowledgeBaseId, knowledgeAdmin(c))
	}
	if err != nil {
		status := http.StatusInternalServerError
		message := "读取目标知识库失败"
		if err == gorm.ErrRecordNotFound {
			status, message = http.StatusForbidden, "无权访问目标知识库"
		}
		c.JSON(status, gin.H{"success": false, "message": message})
		return
	}
	if !canWritePublishedKnowledge(c, target) {
		return
	}
	if removeSource && !canWritePublishedKnowledge(c, source) {
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
	if !enforcePersonalKnowledgeQuota(c, target, sourceDocument.Size) {
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
		_ = model.DeleteKnowledgeDocumentCreators(target.Id, ids)
		_ = model.DeleteKnowledgeDocumentCovers(target.Id, ids)
	} else if len(conflicts) > 0 && input.ConflictPolicy == "keep" {
		uploadName = uniqueKnowledgeDocumentName(filename, targetDocuments)
	}
	_, body, err := client.DownloadDocument(c.Request.Context(), source.RagflowDatasetId, documentId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	sourcePaths, _ := model.ListKnowledgeDocumentPaths(source.Id)
	sourceCreators, _ := model.ListKnowledgeDocumentCreators(source.Id)
	// The copy keeps the original uploader; files without one belong to whoever transferred them.
	creatorId := sourceCreators[documentId]
	if creatorId <= 0 {
		creatorId = c.GetInt("id")
	}
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
	if len(knowledgeDocumentIDs(uploaded)) == 0 {
		c.JSON(502, gin.H{"success": false, "message": "目标知识库未返回有效文件，源文件已保留"})
		return
	}
	for index := range uploaded {
		if uploaded[index].Id == "" {
			continue
		}
		if err := model.SaveKnowledgeDocumentCreator(target.Id, uploaded[index].Id, creatorId); err != nil {
			_ = client.DeleteDocuments(c.Request.Context(), target.RagflowDatasetId, knowledgeDocumentIDs(uploaded))
			c.JSON(500, gin.H{"success": false, "message": "保存目标文件上传人失败，源文件已保留"})
			return
		}
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
	queueKnowledgePDFCover(c.Request.Context(), target.Id, uploadName, uploaded)
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
		_ = model.DeleteKnowledgeDocumentCreators(source.Id, []string{documentId})
		_ = model.DeleteKnowledgeDocumentCovers(source.Id, []string{documentId})
	}
	if err := model.RecordKnowledgeActivity(model.DB, target, c.GetInt("id"), "transfer", "transferred", source.Name, uploadName, "success"); err != nil {
		c.JSON(500, gin.H{"success": false, "message": "文件已转入，但日志保存失败"})
		return
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
	applyKnowledgeDocumentCreators(c.Request.Context(), row.Id, c.GetInt("id"), documents)
	applyKnowledgeAudioPlaybackStatus(documents)
	if !includeSummary {
		states, err := model.ListKnowledgeDocumentCoverStates(row.Id)
		if err != nil {
			logger.Errorf(c.Request.Context(), "list PDF covers: %s", err)
		}
		for index := range documents {
			documents[index].CoverStatus = states[documents[index].Id]
		}
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

// applyKnowledgeDocumentCreators annotates documents with the display name of the OneAPI user who uploaded them.
// Files without a recorded uploader, and files uploaded by viewerId, keep an empty creator name;
// a failed lookup leaves every file unannotated.
func applyKnowledgeDocumentCreators(ctx context.Context, baseId int, viewerId int, documents []ragflow.Document) {
	creators, err := model.ListKnowledgeDocumentCreators(baseId)
	if err != nil {
		logger.Errorf(ctx, "list knowledge document creators: %s", err.Error())
		return
	}
	if len(creators) == 0 {
		return
	}
	for index := range documents {
		documents[index].UploaderUserId = creators[documents[index].Id]
	}
	userIds := make([]int, 0, len(creators))
	seen := map[int]struct{}{}
	for _, document := range documents {
		userId := creators[document.Id]
		if _, ok := seen[userId]; userId > 0 && userId != viewerId && !ok {
			seen[userId] = struct{}{}
			userIds = append(userIds, userId)
		}
	}
	names, err := model.KnowledgeUserDisplayNames(userIds)
	if err != nil {
		logger.Errorf(ctx, "list knowledge creator names: %s", err.Error())
		return
	}
	for index := range documents {
		userId := creators[documents[index].Id]
		if userId <= 0 || userId == viewerId {
			continue
		}
		documents[index].CreatorName = names[userId]
	}
}

func uploadKnowledgeDocument(c *gin.Context, row *model.KnowledgeBase) {
	if !canWritePublishedKnowledge(c, row) {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxKnowledgeUploadBytes)
	header, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请选择不超过 20MB 的文件"})
		return
	}
	if !enforcePersonalKnowledgeQuota(c, row, header.Size) {
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
	for index := range documents {
		if documents[index].Id == "" {
			continue
		}
		if saveErr := model.SaveKnowledgeDocumentCreator(row.Id, documents[index].Id, c.GetInt("id")); saveErr != nil {
			logger.Errorf(c.Request.Context(), "save knowledge document creator: %s", saveErr.Error())
		}
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
	queueKnowledgePDFCover(c.Request.Context(), row.Id, header.Filename, documents)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": documents})
	// Audio is kept for playback; RAGFlow chunking fails or is unsupported for these types.
	if !isKnowledgeAudioFilename(header.Filename) {
		startKnowledgeDocumentParse(client, row.RagflowDatasetId, knowledgeDocumentIDs(documents))
	}
}

func isKnowledgeAudioFilename(name string) bool {
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".webm", ".mp4":
		return true
	default:
		return false
	}
}

// applyKnowledgeAudioPlaybackStatus treats audio as playback-ready. RAGFlow chunking is
// skipped on upload; list responses must not surface FAIL/UNSTART as parse failures.
func applyKnowledgeAudioPlaybackStatus(documents []ragflow.Document) {
	for index := range documents {
		name := documents[index].Name
		if documents[index].Location != "" {
			name = documents[index].Location
		}
		if !isKnowledgeAudioFilename(name) {
			continue
		}
		documents[index].Run = "DONE"
		documents[index].Progress = 1
	}
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

const maxKnowledgeRecommendations = 3
const knowledgeParsingAnswer = "文件正在解析，请稍后重试"
const knowledgeNoParsedAnswer = "知识库尚无可检索内容，请等待文件解析完成后再试"

// ensureKnowledgeQuestionMark appends a Chinese question mark when the prompt has none.
func ensureKnowledgeQuestionMark(value string) string {
	if strings.HasSuffix(value, "？") || strings.HasSuffix(value, "?") {
		return value
	}
	return value + "？"
}

// limitKnowledgeRecommendations keeps up to three unique non-empty related questions.
func limitKnowledgeRecommendations(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	out := make([]string, 0, maxKnowledgeRecommendations)
	seen := make(map[string]struct{}, maxKnowledgeRecommendations)
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		trimmed = ensureKnowledgeQuestionMark(trimmed)
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
		if len(out) >= maxKnowledgeRecommendations {
			break
		}
	}
	return out
}

// knowledgeAskDeferral is why OneAPI answers without creating or updating a RAGFlow chat.
// RAGFlow CreateChat/UpdateChat reject datasets with chunk_num == 0 ("doesn't own parsed file").
type knowledgeAskDeferral string

const (
	knowledgeAskReady    knowledgeAskDeferral = ""
	knowledgeAskParsing  knowledgeAskDeferral = "parsing"
	knowledgeAskNoChunks knowledgeAskDeferral = "no-chunks"
)

// knowledgeDocumentsStillParsing reports whether the ask target is still chunking.
// With document ids, any still-parsing id blocks the ask. Without ids, the library
// blocks only when it has files and none are ready while at least one is still parsing.
func knowledgeDocumentsStillParsing(ctx context.Context, client *ragflow.Client, datasetId string, docIds ...string) (bool, error) {
	deferral, err := knowledgeAskDeferralFor(ctx, client, datasetId, docIds...)
	return deferral == knowledgeAskParsing, err
}

// knowledgeAskDeferralFor reports whether chat create/update must wait for chunks.
// RAGFlow refuses assistants until the dataset has at least one parsed chunk, so this
// check runs before ensureKnowledgeConversation; otherwise CreateChat surfaces a gateway error.
func knowledgeAskDeferralFor(ctx context.Context, client *ragflow.Client, datasetId string, docIds ...string) (knowledgeAskDeferral, error) {
	filtered := make([]string, 0, len(docIds))
	for _, id := range docIds {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	if len(filtered) > 0 {
		anyChunks := false
		anyParsing := false
		for _, id := range filtered {
			doc, err := client.GetDocument(ctx, datasetId, id)
			if err != nil {
				return knowledgeAskReady, err
			}
			if ragflow.DocumentHasChunks(doc) {
				anyChunks = true
				continue
			}
			if ragflow.DocumentParsing(doc) {
				anyParsing = true
			}
		}
		if anyChunks {
			return knowledgeAskReady, nil
		}
		if anyParsing {
			return knowledgeAskParsing, nil
		}
		return knowledgeAskNoChunks, nil
	}
	docs, err := client.ListDocuments(ctx, datasetId)
	if err != nil {
		return knowledgeAskReady, err
	}
	if len(docs) == 0 {
		return knowledgeAskNoChunks, nil
	}
	anyChunks := false
	anyParsing := false
	for _, doc := range docs {
		if ragflow.DocumentHasChunks(doc) {
			anyChunks = true
			break
		}
		if ragflow.DocumentParsing(doc) {
			anyParsing = true
		}
	}
	if anyChunks {
		return knowledgeAskReady, nil
	}
	if anyParsing {
		return knowledgeAskParsing, nil
	}
	return knowledgeAskNoChunks, nil
}

func writeKnowledgeDeferredAnswer(c *gin.Context, stream bool, answer string) {
	payload := gin.H{
		"answer": answer, "recommendations": []string{},
		"citations": []ragflow.Citation{},
	}
	if !stream {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": payload})
		return
	}
	flusher, canFlush := c.Writer.(http.Flusher)
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(http.StatusOK)
	payload["done"] = true
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	if canFlush {
		flusher.Flush()
	}
}

func writeKnowledgeParsingAnswer(c *gin.Context, stream bool) {
	writeKnowledgeDeferredAnswer(c, stream, knowledgeParsingAnswer)
}

func writeKnowledgeNoParsedAnswer(c *gin.Context, stream bool) {
	writeKnowledgeDeferredAnswer(c, stream, knowledgeNoParsedAnswer)
}

// deferKnowledgeAskIfNeeded answers with a product tip when RAGFlow cannot own a chat yet.
func deferKnowledgeAskIfNeeded(c *gin.Context, client *ragflow.Client, datasetId string, stream bool, docIds ...string) bool {
	deferral, err := knowledgeAskDeferralFor(c.Request.Context(), client, datasetId, docIds...)
	if err != nil {
		logger.SysErrorf("knowledge ask deferral check failed for dataset %s: %s", datasetId, err.Error())
		return false
	}
	switch deferral {
	case knowledgeAskParsing:
		writeKnowledgeParsingAnswer(c, stream)
		return true
	case knowledgeAskNoChunks:
		writeKnowledgeNoParsedAnswer(c, stream)
		return true
	default:
		return false
	}
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

func recreateKnowledgeConversation(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, userId int, modelName string, existing *model.KnowledgeConversation, stream bool) (model.KnowledgeConversation, bool) {
	name := fmt.Sprintf("knowledge-%d-%d", userId, time.Now().UnixMilli())
	chat, createErr := client.CreateChat(c.Request.Context(), name, base.RagflowDatasetId, modelName)
	if createErr != nil {
		if ragflow.NoParsedFiles(createErr) {
			writeKnowledgeNoParsedAnswer(c, stream)
			return model.KnowledgeConversation{}, false
		}
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
	prepareKnowledgeBilling(c, base)

	if deferKnowledgeAskIfNeeded(c, client, base.RagflowDatasetId, stream, docIds...) {
		return
	}
	// Refresh the assistant prompt so older chats also emit citation markers.
	if err := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, conversation.Model); err != nil {
		if ragflow.NoParsedFiles(err) {
			writeKnowledgeNoParsedAnswer(c, stream)
			return
		}
		if !ragflow.ChatOwnershipLost(err) {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}
	}
	terms, termsErr := model.ReadKnowledgeCreditTerms(base, c.GetInt("id"))
	if termsErr != nil {
		knowledgeCreditFailure(c, 500, termsErr)
		return
	}
	requestId, questionKey := "", ""
	if terms != nil {
		if quoted := c.GetHeader("X-Knowledge-Price"); quoted != "" && quoted != strconv.FormatInt(terms.Price.QuestionCents, 10) {
			knowledgeCreditFailure(c, 409, errors.New("知识库问答单价已变更，请重试"))
			return
		}
		var saved string
		var beginErr error
		requestId, questionKey, saved, beginErr = beginMeteredKnowledgeQuestion(c, base, conversation, question, docIds)
		if beginErr != nil {
			knowledgeCreditFailure(c, 409, beginErr)
			return
		}
		if saved != "" {
			writeMeteredKnowledgeAnswer(c, stream, saved)
			return
		}
	}
	if stream && terms == nil {
		answerKnowledgeConversationStream(c, client, base, conversation, question, docIds...)
		return
	}
	if terms != nil {
		if err := model.ReserveKnowledgeCredits(c.GetInt("id"), base, terms, "question", requestId, ""); err != nil {
			knowledgeCreditFailure(c, 402, err)
			return
		}
	}
	readyToSettle := false
	defer func() {
		if terms != nil && !readyToSettle {
			releaseKnowledgeOperation(c, base.Id, "question", requestId, "")
		}
	}()
	if terms != nil {
		var pending model.KnowledgeCreditQuestion
		if err := model.DB.First(&pending, "key = ?", questionKey).Error; err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
		if pending.Answer != "" {
			readyToSettle = true
			var data struct {
				Citations []ragflow.Citation `json:"citations"`
			}
			if err := json.Unmarshal([]byte(pending.Answer), &data); err != nil {
				knowledgeCreditFailure(c, 500, err)
				return
			}
			if _, err := model.SettleKnowledgeCredits(c.GetInt("id"), base, terms, "question", requestId, knowledgeCreditDocuments(data.Citations), questionKey, pending.Answer); err != nil {
				knowledgeCreditFailure(c, 402, err)
				return
			}
			writeMeteredKnowledgeAnswer(c, stream, pending.Answer)
			return
		}
	}
	completion, err := completeWithRecovery(c, client, base, conversation, question, docIds...)
	if err != nil {
		if c.Writer.Written() {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	readyToSettle = true
	recommendations, recommendationErr := client.Recommend(c.Request.Context(), question)
	recommendations = limitKnowledgeRecommendations(recommendations)
	citations := ragflow.ParseCitations(completion.Reference, completion.Answer)
	data := gin.H{
		"answer": completion.Answer, "reference": completion.Reference,
		"recommendations": recommendations, "citations": citations,
	}
	if recommendationErr != nil {
		data["recommendation_warning"] = recommendationErr.Error()
	}
	if terms != nil {
		if c.Request.Context().Err() != nil {
			return
		}
		payload, err := json.Marshal(data)
		if err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
		if err := model.DB.Model(&model.KnowledgeCreditQuestion{}).Where("key = ?", questionKey).Update("answer", string(payload)).Error; err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
		if _, err := model.SettleKnowledgeCredits(c.GetInt("id"), base, terms, "question", requestId, knowledgeCreditDocuments(citations), questionKey, string(payload)); err != nil {
			knowledgeCreditFailure(c, 402, err)
			return
		}
		writeMeteredKnowledgeAnswer(c, stream, string(payload))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func completeWithRecovery(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, conversation model.KnowledgeConversation, question string, docIds ...string) (ragflow.Completion, error) {
	completion, err := client.Complete(c.Request.Context(), conversation.RagflowChatId, conversation.RagflowSessionId, question, docIds...)
	if err != nil && ragflow.ChatOwnershipLost(err) {
		recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation, false)
		if !ok {
			return ragflow.Completion{}, err
		}
		conversation = recreated
		completion, err = client.Complete(c.Request.Context(), conversation.RagflowChatId, conversation.RagflowSessionId, question, docIds...)
	}
	if err != nil && ragflow.TooManyNestedClauses(err) {
		if updateErr := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, conversation.Model); updateErr != nil {
			if ragflow.ChatOwnershipLost(updateErr) {
				recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation, false)
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
					recommendations = limitKnowledgeRecommendations(recommendations)
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
		recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation, true)
		if !ok {
			return
		}
		conversation = recreated
		err = run(conversation)
	}
	if err != nil && ragflow.TooManyNestedClauses(err) && !headersStarted {
		if updateErr := client.UpdateChat(c.Request.Context(), conversation.RagflowChatId, base.RagflowDatasetId, conversation.Model); updateErr != nil {
			if ragflow.ChatOwnershipLost(updateErr) {
				recreated, ok := recreateKnowledgeConversation(c, client, base, conversation.UserId, conversation.Model, &conversation, true)
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

func ensureKnowledgeConversation(c *gin.Context, client *ragflow.Client, base *model.KnowledgeBase, modelName string, stream bool) (model.KnowledgeConversation, bool) {
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
			if ragflow.NoParsedFiles(updateErr) {
				writeKnowledgeNoParsedAnswer(c, stream)
				return conversation, false
			}
			if ragflow.ChatOwnershipLost(updateErr) {
				return recreateKnowledgeConversation(c, client, base, userId, modelToUse, &conversation, stream)
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
	return recreateKnowledgeConversation(c, client, base, userId, modelName, nil, stream)
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
	applies, creditErr := model.KnowledgeCreditApplies(base, c.GetInt("id"))
	if creditErr != nil {
		knowledgeCreditFailure(c, 500, creditErr)
		return
	}
	if applies {
		pending, err := model.KnowledgeCreditQuestionPending(conversation.RagflowSessionId)
		if err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
		if pending {
			knowledgeCreditFailure(c, 402, errors.New("上次问答未结算，请清空会话后重试"))
			return
		}
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
			if _, recreated := recreateKnowledgeConversation(c, client, base, c.GetInt("id"), conversation.Model, &conversation, false); !recreated {
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
	// Defer before CreateChat/UpdateChat: RAGFlow rejects datasets with zero chunks.
	if deferKnowledgeAskIfNeeded(c, client, base.RagflowDatasetId, input.Stream, input.DocumentId) {
		return
	}
	conversation, ok := ensureKnowledgeConversation(c, client, base, input.Model, input.Stream)
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

// SetKnowledgeBaseLike updates the authenticated viewer's saved plaza preference.
func SetKnowledgeBaseLike(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return
	}
	err = model.SetKnowledgeBaseLike(c.GetInt("id"), id, c.Request.Method == http.MethodPost)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "知识库不存在"})
		return
	}
	if err != nil {
		logger.Errorf(c.Request.Context(), "save knowledge like: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存喜欢状态失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// canWritePublishedKnowledge keeps shared personal libraries writable only by their owner or root operator.
func canWritePublishedKnowledge(c *gin.Context, base *model.KnowledgeBase) bool {
	if base.PublicationScope == "" || base.OwnerUserId == c.GetInt("id") || knowledgeAdmin(c) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "仅所有者可修改已发布知识库"})
	return false
}
