package controller

import (
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm/clause"
)

// ListKnowledgeFolders returns persisted folders for an authorized library.
func ListKnowledgeFolders(c *gin.Context) {
	row, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	names, err := model.ListKnowledgeFolders(row.Id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取文件夹失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": names})
}

// DeleteKnowledgeFolder removes only an empty folder owned by the caller.
// Files and descendant folder records are never removed by this operation.
func DeleteKnowledgeFolder(c *gin.Context) {
	row, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	if row.Kind != model.KnowledgeBasePersonal || row.CategoryId != 0 || row.OwnerUserId != c.GetInt("id") {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "仅个人知识库支持删除文件夹"})
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件夹名称无效"})
		return
	}
	names, err := model.ListKnowledgeFolders(row.Id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取文件夹失败"})
		return
	}
	found := false
	for _, name := range names {
		if name == input.Name {
			found = true
		}
		if strings.HasPrefix(name, input.Name+"/") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "文件夹有内容，请先删除文件和子文件夹"})
			return
		}
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "文件夹不存在"})
		return
	}
	client, ok := knowledgeClient(c)
	if !ok {
		return
	}
	documents, err := client.ListDocuments(c.Request.Context(), row.RagflowDatasetId)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	paths, err := model.ListKnowledgeDocumentPaths(row.Id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取文件路径失败"})
		return
	}
	for _, document := range documents {
		name := document.Name
		if document.Location != "" {
			name = document.Location
		}
		if saved, exists := paths[document.Id]; exists {
			name = saved
		}
		if strings.HasPrefix(strings.TrimLeft(strings.ReplaceAll(name, "\\", "/"), "/"), input.Name+"/") {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "文件夹有内容，请先删除文件和子文件夹"})
			return
		}
	}
	result := model.DB.Where("knowledge_base_id = ? AND name = ?", row.Id, input.Name).Delete(&model.KnowledgeFolder{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "删除文件夹失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// CreateKnowledgeFolder saves a folder path in the caller's personal library.
func CreateKnowledgeFolder(c *gin.Context) {
	row, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	if row.Kind != model.KnowledgeBasePersonal || row.CategoryId != 0 || row.OwnerUserId != c.GetInt("id") {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "仅个人知识库支持新建文件夹"})
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件夹名称无效"})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	valid := input.Name != "" && len(input.Name) <= 512 && !strings.Contains(input.Name, "\\") && strings.IndexFunc(input.Name, unicode.IsControl) < 0
	for _, segment := range strings.Split(input.Name, "/") {
		if segment == "" || segment == "." || segment == ".." || strings.TrimSpace(segment) != segment || utf8.RuneCountInString(segment) > 128 {
			valid = false
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "文件夹名称无效"})
		return
	}
	folder := model.KnowledgeFolder{KnowledgeBaseId: row.Id, Name: input.Name}
	result := model.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&folder)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "创建文件夹失败"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "文件夹已存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": input.Name})
}
