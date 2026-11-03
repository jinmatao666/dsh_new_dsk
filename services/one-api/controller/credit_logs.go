package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

func GetCreditLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("p"))
	if page < 0 {
		page = 0
	}
	size := 50
	query := model.LOG_DB.Model(&model.Log{}).Where("type = ?", model.LogTypeConsume)
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("username LIKE ? OR model_name LIKE ? OR request_id LIKE ?", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取积分明细失败"})
		return
	}
	var logs []model.Log
	if err := query.Order("id DESC").Offset(page * size).Limit(size).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取积分明细失败"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": logs, "total": total, "page_size": size}})
}
