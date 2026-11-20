package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// knowledgeReturnUploader resolves the recorded uploader of an authorized public file.
func knowledgeReturnUploader(base *model.KnowledgeBase, documentId string) (int, error) {
	public := base.PublicationScope == "public"
	if base.CategoryId > 0 {
		category, err := model.GetKnowledgeCategory(base.CategoryId)
		if err != nil {
			return 0, err
		}
		public = category.Type == model.KnowledgeBaseCommon && !category.RequireAuth
	} else if base.Kind == model.KnowledgeBaseCommon {
		public = true
	}
	if !public {
		return 0, errors.New("仅公共知识库文件支持转回上传人个人库")
	}
	creators, err := model.ListKnowledgeDocumentCreators(base.Id)
	if err != nil {
		return 0, err
	}
	if creators[documentId] <= 0 {
		return 0, errors.New("该文件没有上传人记录，无法转回个人库")
	}
	return creators[documentId], nil
}

// ListKnowledgeReturnTargets lists only private personal libraries owned by the uploader.
func ListKnowledgeReturnTargets(c *gin.Context) {
	base, ok := managedKnowledgeBase(c)
	if !ok {
		return
	}
	documentId, ok := managedDocumentID(c)
	if !ok {
		return
	}
	uploader, err := knowledgeReturnUploader(base, documentId)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": err.Error()})
		return
	}
	var targets []model.KnowledgeBase
	err = model.DB.Where("owner_user_id = ? AND kind = ? AND category_id = 0 AND publication_scope = ''", uploader, model.KnowledgeBasePersonal).Order("id").Find(&targets).Error
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "读取上传人个人知识库失败"})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": targets})
}

// ReturnManagedKnowledgeDocument moves a public file back to its recorded uploader.
func ReturnManagedKnowledgeDocument(c *gin.Context) {
	transferKnowledgeDocument(c, true, true)
}
