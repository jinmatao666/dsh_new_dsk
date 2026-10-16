package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// GetUserActivityLogs 获取指定用户的账户动态记录
// GET /api/user/:id/activity-logs?page=0&size=20
func GetUserActivityLogs(c *gin.Context) {
	userIdStr := c.Param("id")
	userId, err := strconv.Atoi(userIdStr)
	if err != nil || userId <= 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的用户 ID",
		})
		return
	}

	// 验证用户是否存在
	_, err = model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户不存在",
		})
		return
	}

	page, _ := strconv.Atoi(c.Query("page"))
	size, _ := strconv.Atoi(c.Query("size"))
	if page < 0 {
		page = 0
	}
	if size <= 0 || size > 100 {
		size = 20
	}

	logs, total, err := model.GetUserActivityLogs(userId, page*size, size)
	if err != nil {
		// GORM "record not found" 不应该出现在 Find 查询，但防御性处理
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "查询账户动态失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": logs,
			"total": total,
		},
	})
}
