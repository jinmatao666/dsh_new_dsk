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
