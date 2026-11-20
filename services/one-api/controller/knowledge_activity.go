package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"net/http"
	"strconv"
	"strings"
)

// ListManagedKnowledgeActivities returns administrator-only historical events with actor names.
func ListManagedKnowledgeActivities(c *gin.Context) {
	if !knowledgeReviewAdmin(c) {
		return
	}
	tab := c.Query("tab")
	if tab != "" && tab != "personal" && tab != "transferred" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "日志类型无效"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	query := model.DB.Model(&model.KnowledgeActivity{})
	if tab != "" {
		query = query.Where("tab = ?", tab)
	}
	if c.GetInt("role") < model.RoleRootUser {
		query = query.Where("actor_id = ? OR creator_id = ?", c.GetInt("id"), c.GetInt("id"))
	}
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		like := "%" + keyword + "%"
		users := model.DB.Model(&model.User{}).Select("id").
			Where("username LIKE ? OR display_name LIKE ?", like, like)
		query = query.Where(
			"knowledge_base_name LIKE ? OR source_name LIKE ? OR document_name LIKE ? OR creator_id IN (?) OR actor_id IN (?) OR applicant_id IN (?)",
			like, like, like, users, users, users,
		)
	}
	var total int64
	var rows []model.KnowledgeActivity
	if err := query.Count(&total).Error; err != nil {
		c.JSON(500, gin.H{"success": false, "message": "读取知识库日志失败"})
		return
	}
	if err := query.Order("created_at DESC, id DESC").Offset((page - 1) * 20).Limit(20).Find(&rows).Error; err != nil {
		c.JSON(500, gin.H{"success": false, "message": "读取知识库日志失败"})
		return
	}
	ids := make([]int, 0, len(rows)*2)
	for _, row := range rows {
		ids = append(ids, row.CreatorId, row.ActorId, row.ApplicantId)
	}
	names, err := model.KnowledgeUserDisplayNames(ids)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "读取日志人员失败"})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": rows, "total": total, "page": page, "names": names}})
}

// deleteKnowledgeDocumentWithActivity retains file metadata before deleting remote content.
func deleteKnowledgeDocumentWithActivity(c *gin.Context, base *model.KnowledgeBase, documentId string) {
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	name := documentId
	document, err := client.GetDocument(c.Request.Context(), base.RagflowDatasetId, documentId)
	if err == nil && document.Name != "" {
		name = document.Name
	}
	if err := client.DeleteDocuments(c.Request.Context(), base.RagflowDatasetId, []string{documentId}); err != nil && !remoteKnowledgeMissing(err) {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := model.RecordKnowledgeActivity(tx, base, c.GetInt("id"), "delete_document", "personal", "", name, "success"); err != nil {
			return err
		}
		for _, row := range []interface{}{&model.KnowledgeDocumentNote{}, &model.KnowledgeDocumentPath{}, &model.KnowledgeDocumentCreator{}, &model.KnowledgeDocumentCover{}} {
			if err := tx.Where("knowledge_base_id = ? AND document_id = ?", base.Id, documentId).Delete(row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "文件已移除，但删除日志或文件元数据保存失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已删除文件"})
}
