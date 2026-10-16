package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// AdminListVersionNotes 后台:列出更新说明(可按 platform 过滤)。
func AdminListVersionNotes(c *gin.Context) {
	platform := c.Query("platform")
	notes, err := model.ListVersionNotes(platform)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": notes})
}

// AdminCreateVersionNote 后台:新建更新说明。
func AdminCreateVersionNote(c *gin.Context) {
	var note model.VersionNote
	if err := c.ShouldBindJSON(&note); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	note.Id = 0
	if err := model.CreateVersionNote(&note); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": note})
}

// AdminUpdateVersionNote 后台:更新更新说明。
func AdminUpdateVersionNote(c *gin.Context) {
	var note model.VersionNote
	if err := c.ShouldBindJSON(&note); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if note.Id == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "ID不能为空"})
		return
	}
	if err := model.UpdateVersionNote(&note); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// AdminDeleteVersionNote 后台:删除更新说明。
func AdminDeleteVersionNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的ID"})
		return
	}
	if err := model.DeleteVersionNote(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// GetVersionNote 公开:按 platform+version 查询更新说明,供发布脚本读取。
// 更新说明本就是用户可见信息,无需鉴权;不存在时 success=false 由脚本据此中止发布。
func GetVersionNote(c *gin.Context) {
	platform := c.Query("platform")
	if platform == "" {
		platform = model.VersionPlatformApp
	}
	version := c.Query("version")
	if version == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "版本号不能为空"})
		return
	}
	note, err := model.GetVersionNote(platform, version)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "未找到该版本的更新说明"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": note})
}
