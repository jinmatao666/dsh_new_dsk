package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// GetAdminOperationLogStats 获取后台操作统计（AdminAuth）
func GetAdminOperationLogStats(c *gin.Context) {
	startTime, endTime := parseTimePeriod(c)
	action := c.Query("action")
	module := c.Query("module")

	stats, err := model.GetAdminOperationLogStats(startTime, endTime, action, module)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	trend, err := model.GetAdminOperationLogTrend(startTime, endTime, action, module)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"stats": stats,
			"trend": trend,
		},
	})
}

// GetAdminOperationLogList 获取后台操作明细列表（AdminAuth）
func GetAdminOperationLogList(c *gin.Context) {
	startTime, endTime := parseTimePeriod(c)
	action := c.Query("action")
	module := c.Query("module")
	username := c.Query("username")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))

	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	offset := (page - 1) * perPage
	logs, total, err := model.GetAdminOperationLogList(startTime, endTime, action, module, username, offset, perPage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":      logs,
			"total":      total,
			"page":       page,
			"per_page":   perPage,
			"totalPages": (total + int64(perPage) - 1) / int64(perPage),
		},
	})
}

// GetAdminOperationLogActions 返回最近一段时间内出现过的动作名列表（AdminAuth）
func GetAdminOperationLogActions(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}
	since := time.Now().AddDate(0, 0, -days)

	actions, err := model.GetAdminOperationLogActions(since)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    actions,
	})
}
