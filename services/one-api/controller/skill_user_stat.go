package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// RecordSkillDownload 接收完整技能包下载后的确认，不把安装失败算成下载失败。
func RecordSkillDownload(c *gin.Context) { recordSkillUserActivity(c, false) }

// RecordSkillInstallation 仅确认当前用户已下载的包；重试不会重复安装计数。
func RecordSkillInstallation(c *gin.Context) { recordSkillUserActivity(c, true) }

func recordSkillUserActivity(c *gin.Context, install bool) {
	userID := c.GetInt("id")
	if userID < 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	var input struct {
		EventID string `json:"event_id" binding:"required,max=64"`
		Version string `json:"version" binding:"max=50"`
	}
	if err != nil || id < 1 || c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的技能统计参数"})
		return
	}
	if !install {
		if _, err := model.GetVisibleSkillById(id); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "技能不可下载"})
			return
		}
		err = model.RecordSkillDownload(id, userID, input.EventID, input.Version)
	} else {
		// 下载后技能即使被下架，仍保留此次实际安装结果。
		err = model.RecordSkillInstallation(id, userID, input.EventID)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "技能统计记录失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
