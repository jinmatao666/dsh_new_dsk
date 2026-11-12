package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"net/http"
	"strconv"
	"strings"
)

func knowledgePublicationEnabled() (bool, error) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	settings, err := parseDesktopDeploymentSettings(raw)
	return settings.Edition == "operations", err
}

func publicationFailure(c *gin.Context, err error) {
	code := http.StatusInternalServerError
	message := "处理知识库发布申请失败"
	if errors.Is(err, gorm.ErrRecordNotFound) {
		code = http.StatusNotFound
		message = "知识库或申请不存在"
	}
	if errors.Is(err, model.ErrKnowledgePublicationInvalid) {
		code = http.StatusBadRequest
		message = err.Error()
	}
	if errors.Is(err, model.ErrKnowledgePublicationPending) {
		code = http.StatusConflict
		message = err.Error()
	}
	c.JSON(code, gin.H{"success": false, "message": message})
}

func publicationBase(c *gin.Context) (*model.KnowledgeBase, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "知识库编号无效"})
		return nil, false
	}
	base, err := model.GetKnowledgeBase(id)
	if err != nil {
		publicationFailure(c, err)
		return nil, false
	}
	if base.OwnerUserId != c.GetInt("id") {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "仅所有者可申请转换知识库"})
		return nil, false
	}
	return base, true
}

// GetKnowledgePublication returns the owner's saved request and the deployment's publication availability.
func GetKnowledgePublication(c *gin.Context) {
	base, ok := publicationBase(c)
	if !ok {
		return
	}
	enabled, err := knowledgePublicationEnabled()
	if err != nil {
		publicationFailure(c, err)
		return
	}
	application, err := model.GetKnowledgePublication(base.Id)
	if err != nil {
		publicationFailure(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"enabled": enabled, "application": application}})
}

// ApplyKnowledgePublication queues an owner-only conversion request in the operations edition.
func ApplyKnowledgePublication(c *gin.Context) {
	enabled, err := knowledgePublicationEnabled()
	if err != nil {
		publicationFailure(c, err)
		return
	}
	if !enabled {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "当前版本不支持知识库转换申请"})
		return
	}
	base, ok := publicationBase(c)
	if !ok {
		return
	}
	var input struct {
		Target string `json:"target"`
		Reason string `json:"reason"`
	}
	if c.ShouldBindJSON(&input) != nil || (input.Target != "public" && input.Target != "subscription") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请选择发布范围"})
		return
	}
	if input.Target == "subscription" {
		billing, _, err := model.KnowledgeCreditPolicy()
		if err != nil {
			publicationFailure(c, err)
			return
		}
		if billing {
			_, configured, err := model.GetKnowledgeCreditPrice(base.Id)
			if err != nil {
				publicationFailure(c, err)
				return
			}
			if !configured {
				knowledgeCreditFailure(c, 400, errors.New("请先设置知识库积分单价"))
				return
			}
		}
	}
	row, err := model.ApplyKnowledgePublication(c.GetInt("id"), base.Id, input.Target, input.Reason)
	if err != nil {
		publicationFailure(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

// ListManagedKnowledgePublications returns publication tasks for administrator review.
func ListManagedKnowledgePublications(c *gin.Context) {
	if !knowledgeReviewAdmin(c) {
		return
	}
	status := strings.TrimSpace(c.DefaultQuery("status", model.KnowledgeSubscriptionPending))
	if status != "" && status != "pending" && status != "approved" && status != "rejected" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "审核状态无效"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	rows, total, err := model.ListKnowledgePublications(status, page, size)
	if err != nil {
		publicationFailure(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": rows, "total": total, "page": page, "page_size": size}})
}

// ReviewManagedKnowledgePublication settles a publication task after administrator authorization.
func ReviewManagedKnowledgePublication(c *gin.Context) {
	if !knowledgeReviewAdmin(c) {
		return
	}
	enabled, err := knowledgePublicationEnabled()
	if err != nil {
		publicationFailure(c, err)
		return
	}
	if !enabled {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "当前版本不支持知识库转换审核"})
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "申请编号无效"})
		return
	}
	var input struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if c.ShouldBindJSON(&input) != nil || (input.Decision != "approve" && input.Decision != "reject") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "审核决定无效"})
		return
	}
	row, err := model.ReviewKnowledgePublication(id, c.GetInt("id"), input.Decision == "approve", input.Note)
	if err != nil {
		publicationFailure(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": row})
}

func knowledgeReviewAdmin(c *gin.Context) bool {
	if c.GetInt("role") >= model.RoleAdminUser {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "仅管理员可审核知识库申请"})
	return false
}

// publicationReviewLibrary permits administrators to inspect only a library attached to a publication request.
func publicationReviewLibrary(c *gin.Context) bool {
	if !knowledgeReviewAdmin(c) {
		return false
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "申请编号无效"})
		return false
	}
	var application model.KnowledgePublicationApplication
	if err := model.DB.First(&application, id).Error; err != nil {
		publicationFailure(c, err)
		return false
	}
	c.Set("knowledge_publication_review", true)
	for i := range c.Params {
		if c.Params[i].Key == "id" {
			c.Params[i].Value = strconv.Itoa(application.KnowledgeBaseId)
		}
	}
	return true
}

// ListKnowledgePublicationDocuments exposes the requested library's catalog to its administrator reviewers.
func ListKnowledgePublicationDocuments(c *gin.Context) {
	if publicationReviewLibrary(c) {
		ListManagedKnowledgeDocuments(c)
	}
}

// DownloadKnowledgePublicationDocument serves an original document for administrator inspection.
func DownloadKnowledgePublicationDocument(c *gin.Context) {
	if publicationReviewLibrary(c) {
		DownloadManagedKnowledgeDocument(c)
	}
}

// ListKnowledgePublicationChunks serves parsed content for administrator inspection.
func ListKnowledgePublicationChunks(c *gin.Context) {
	if publicationReviewLibrary(c) {
		ListManagedKnowledgeChunks(c)
	}
}
