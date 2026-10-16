package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func GetAllLogs(c *gin.Context) {
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if pageSize <= 0 {
		pageSize = config.ItemsPerPage
	}
	if pageSize > 100 {
		pageSize = 100
	}
	logTypes := parseLogTypes(c.Query("types"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	channel, _ := strconv.Atoi(c.Query("channel"))
	requestId := c.Query("request_id")
	slowOnly, _ := strconv.ParseBool(c.Query("slow_only"))
	timingStatus := c.Query("timing_status")
	slowReason := c.Query("slow_reason")
	minFirstChunkMs, _ := strconv.Atoi(c.Query("min_first_chunk_ms"))
	sortField := c.Query("sort_field")
	sortOrder := c.Query("sort_order")
	logs, err := model.GetAllLogs(logTypes, startTimestamp, endTimestamp, modelName, username, tokenName, p*pageSize, pageSize, channel, requestId, slowOnly, timingStatus, slowReason, minFirstChunkMs, sortField, sortOrder)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    logs,
	})
	return
}

func GetUserLogs(c *gin.Context) {
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if pageSize <= 0 {
		pageSize = config.ItemsPerPage
	}
	if pageSize > 100 {
		pageSize = 100
	}
	userId := c.GetInt(ctxkey.Id)
	logTypes := parseLogTypes(c.Query("types"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	requestId := c.Query("request_id")
	slowOnly, _ := strconv.ParseBool(c.Query("slow_only"))
	timingStatus := c.Query("timing_status")
	slowReason := c.Query("slow_reason")
	minFirstChunkMs, _ := strconv.Atoi(c.Query("min_first_chunk_ms"))
	sortField := c.Query("sort_field")
	sortOrder := c.Query("sort_order")
	logs, err := model.GetUserLogs(userId, logTypes, startTimestamp, endTimestamp, modelName, tokenName, p*pageSize, pageSize, requestId, slowOnly, timingStatus, slowReason, minFirstChunkMs, sortField, sortOrder)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    logs,
	})
	return
}

func SearchAllLogs(c *gin.Context) {
	keyword := c.Query("keyword")
	logs, err := model.SearchAllLogs(keyword)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    logs,
	})
	return
}

func SearchUserLogs(c *gin.Context) {
	keyword := c.Query("keyword")
	userId := c.GetInt(ctxkey.Id)
	logs, err := model.SearchUserLogs(userId, keyword)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    logs,
	})
	return
}

func GetLogFilterOptions(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	opts, err := model.GetLogFilterOptions(0, startTimestamp, endTimestamp)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    opts,
	})
}

func GetUserLogFilterOptions(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	opts, err := model.GetLogFilterOptions(userId, startTimestamp, endTimestamp)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    opts,
	})
}

func GetLogsStat(c *gin.Context) {
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	username := c.Query("username")
	modelName := c.Query("model_name")
	channel, _ := strconv.Atoi(c.Query("channel"))
	quotaNum := model.SumUsedQuota(logType, startTimestamp, endTimestamp, modelName, username, tokenName, channel)
	//tokenNum := model.SumUsedToken(logType, startTimestamp, endTimestamp, modelName, username, "")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota": quotaNum,
			//"token": tokenNum,
		},
	})
	return
}

func GetLogsSelfStat(c *gin.Context) {
	username := c.GetString(ctxkey.Username)
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	channel, _ := strconv.Atoi(c.Query("channel"))
	quotaNum := model.SumUsedQuota(logType, startTimestamp, endTimestamp, modelName, username, tokenName, channel)
	//tokenNum := model.SumUsedToken(logType, startTimestamp, endTimestamp, modelName, username, tokenName)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota": quotaNum,
			//"token": tokenNum,
		},
	})
	return
}

func GetLogsSelfTrend(c *gin.Context) {
	username := c.GetString(ctxkey.Username)
	days, _ := strconv.Atoi(c.Query("days"))
	if days <= 0 {
		days = 7
	}
	trend, err := model.GetUserDailyTrend(username, days)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    trend,
	})
	return
}

// parseLogTypes 解析逗号分隔的日志类型参数（如 "2,6"），忽略非法项。空字符串返回 nil（表示全部类型）。
func parseLogTypes(raw string) []int {
	if raw == "" {
		return nil
	}
	var types []int
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if v, err := strconv.Atoi(part); err == nil {
			types = append(types, v)
		}
	}
	return types
}

func GetLogCleanupStat(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "target timestamp is required",
		})
		return
	}
	logTypes := parseLogTypes(c.Query("types"))
	count, estimatedBytes, err := model.CountOldLog(targetTimestamp, logTypes)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"count":           count,
			"estimated_bytes": estimatedBytes,
		},
	})
	return
}

func DeleteHistoryLogs(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "target timestamp is required",
		})
		return
	}
	logTypes := parseLogTypes(c.Query("types"))
	count, err := model.DeleteOldLog(targetTimestamp, logTypes)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
	return
}

func GetUserUsageRanking(c *gin.Context) {
	rangeKey := c.DefaultQuery("range", "7d")
	sort := c.DefaultQuery("sort", "tokens")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))

	now := time.Now()
	var start time.Time
	switch rangeKey {
	case "today":
		start = now.Truncate(24 * time.Hour)
	case "30d":
		start = now.AddDate(0, 0, -30)
	default:
		start = now.AddDate(0, 0, -7)
	}

	rows, err := model.GetUserUsageRanking(start.Unix(), now.Unix(), sort, limit)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// GetSelfQuotaRecords 返回当前用户的全部积分新增记录(含已耗尽/已过期),按时间倒序分页.
// GET /api/user/self/quota-records?p=0&size=20
func GetSelfQuotaRecords(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	size, _ := strconv.Atoi(c.Query("size"))
	if size <= 0 || size > 100 {
		size = 20
	}

	items, total, err := model.GetUserTimedQuotaHistory(userId, p*size, size)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":        true,
		"message":        "",
		"quota_per_unit": config.QuotaPerUnit,
		"data": gin.H{
			"items": items,
			"total": total,
		},
	})
}

// GET /api/user/self/activity-logs?p=0&size=20
// 权益变更记录：积分 / 会员时长 / 优惠券的变动，复用账户动态日志(logs type IN 1,3,4)
func GetSelfActivityLogs(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	size, _ := strconv.Atoi(c.Query("size"))
	if size <= 0 || size > 100 {
		size = 20
	}

	logs, total, err := model.GetUserActivityLogs(userId, p*size, size)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// 为每条记录附加 category，供前端按类型渲染右侧徽章
	items := make([]gin.H, 0, len(logs))
	for _, log := range logs {
		items = append(items, gin.H{
			"content":    log.Content,
			"quota":      log.Quota,
			"type":       log.Type,
			"created_at": log.CreatedAt,
			"category":   activityLogCategory(log.Quota, log.Content),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success":        true,
		"message":        "",
		"quota_per_unit": config.QuotaPerUnit,
		"data": gin.H{
			"items": items,
			"total": total,
		},
	})
}

// activityLogCategory 根据积分变动量与文案推断权益类别
func activityLogCategory(quota int, content string) string {
	switch {
	case quota > 0:
		return "quota"
	case strings.Contains(content, "会员"):
		return "membership"
	case strings.Contains(content, "券"):
		return "coupon"
	case strings.Contains(content, "积分"):
		return "quota"
	default:
		return "other"
	}
}
