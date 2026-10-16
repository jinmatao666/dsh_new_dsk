package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// GetOperationDashboardStats 获取运营看板统计数据
func GetOperationDashboardStats(c *gin.Context) {
	dimension := c.Query("dimension") // activity / crowd
	targetIdStr := c.Query("target_id")
	period := c.DefaultQuery("period", "7d") // today / 7d / 30d

	targetId, err := strconv.Atoi(targetIdStr)
	if err != nil || targetId == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的目标ID",
		})
		return
	}

	// 计算时间范围
	startTs, endTs := parsePeriod(period)

	// 调用聚合查询
	stats, err := model.GetOperationStats(dimension, targetId, startTs, endTs)
	if err != nil {
		logger.SysError("获取运营看板统计失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "统计失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    stats,
	})
}

// ListOperationDashboards 获取用户的看板列表
func ListOperationDashboards(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	dashboards, err := model.ListOperationDashboards(userId)
	if err != nil {
		logger.SysError("获取看板列表失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取失败",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    dashboards,
	})
}

// CreateOperationDashboard 创建看板
func CreateOperationDashboard(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	var body struct {
		Name   string `json:"name"`
		Config string `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}
	if body.Name == "" || body.Config == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "看板名称和配置不能为空",
		})
		return
	}

	dashboard := &model.OperationDashboard{
		UserId: userId,
		Name:   body.Name,
		Config: body.Config,
	}
	if err := model.CreateOperationDashboard(dashboard); err != nil {
		logger.SysError("创建看板失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "创建失败",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    dashboard,
	})
}

// UpdateOperationDashboard 更新看板
func UpdateOperationDashboard(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的看板ID",
		})
		return
	}

	var body struct {
		Name   string `json:"name"`
		Config string `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	dashboard := &model.OperationDashboard{
		Id:     id,
		UserId: userId,
		Name:   body.Name,
		Config: body.Config,
	}
	if err := model.UpdateOperationDashboard(dashboard); err != nil {
		logger.SysError("更新看板失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "更新失败",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
	})
}

// DeleteOperationDashboard 删除看板
func DeleteOperationDashboard(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的看板ID",
		})
		return
	}

	if err := model.DeleteOperationDashboard(userId, id); err != nil {
		logger.SysError("删除看板失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "删除失败",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
	})
}

func getNowTimestamp() int64 {
	return time.Now().Unix()
}

func getTodayStartTimestamp() int64 {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
}

// parsePeriod 解析时间范围字符串为时间戳
func parsePeriod(period string) (startTs, endTs int64) {
	now := getNowTimestamp()
	switch period {
	case "today":
		startTs = getTodayStartTimestamp()
		endTs = now
	case "7d":
		startTs = now - 7*86400
		endTs = now
	case "30d":
		startTs = now - 30*86400
		endTs = now
	default:
		startTs = now - 7*86400
		endTs = now
	}
	return
}
