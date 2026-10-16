package controller

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

// 客户端上报的单条事件
type clientEventItem struct {
	Event string                 `json:"event"`
	Data  map[string]interface{} `json:"data"`
	Ts    int64                  `json:"ts"`
}

// 批量上报请求体
type clientEventBatchRequest struct {
	Events        []clientEventItem `json:"events"`
	ClientVersion string            `json:"client_version"`
	Platform      string            `json:"platform"`
	OsVersion     string            `json:"os_version"`
	Arch          string            `json:"arch"`
}

// ReportClientEvents 接收客户端事件上报（UserAuth）
func ReportClientEvents(c *gin.Context) {
	var req clientEventBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	if len(req.Events) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "no events"})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	username := c.GetString(ctxkey.Username)

	var events []model.ClientEvent
	for _, item := range req.Events {
		dataJSON := ""
		if item.Data != nil {
			if b, err := json.Marshal(item.Data); err == nil {
				dataJSON = string(b)
			}
		}

		createdAt := time.Now()
		if item.Ts > 0 {
			createdAt = time.UnixMilli(item.Ts)
		}

		events = append(events, model.ClientEvent{
			UserId:        userId,
			Username:      username,
			EventName:     item.Event,
			EventData:     dataJSON,
			ClientVersion: req.ClientVersion,
			Platform:      req.Platform,
			OsVersion:     req.OsVersion,
			Arch:          req.Arch,
			CreatedAt:     createdAt,
		})
	}

	if err := model.BatchCreateClientEvents(events); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to save events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// 匿名上报请求体（多一个 device_id 字段）
type clientEventAnonymousRequest struct {
	Events        []clientEventItem `json:"events"`
	ClientVersion string            `json:"client_version"`
	Platform      string            `json:"platform"`
	OsVersion     string            `json:"os_version"`
	Arch          string            `json:"arch"`
	DeviceID      string            `json:"device_id"`
}

// ReportClientEventsAnonymous 接收未登录状态的事件上报（无需认证）
func ReportClientEventsAnonymous(c *gin.Context) {
	var req clientEventAnonymousRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	if len(req.Events) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "no events"})
		return
	}

	// 限制单次最多 50 条，防止滥用
	if len(req.Events) > 50 {
		req.Events = req.Events[:50]
	}

	deviceID := req.DeviceID
	if deviceID == "" {
		deviceID = "unknown"
	}
	// 截取前 8 位，便于管理员阅读
	shortID := deviceID
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}

	var events []model.ClientEvent
	for _, item := range req.Events {
		dataJSON := ""
		if item.Data != nil {
			if b, err := json.Marshal(item.Data); err == nil {
				dataJSON = string(b)
			}
		}

		createdAt := time.Now()
		if item.Ts > 0 {
			createdAt = time.UnixMilli(item.Ts)
		}

		events = append(events, model.ClientEvent{
			UserId:        0,
			Username:      "未登录设备:" + shortID,
			DeviceID:      deviceID,
			EventName:     item.Event,
			EventData:     dataJSON,
			ClientVersion: req.ClientVersion,
			Platform:      req.Platform,
			OsVersion:     req.OsVersion,
			Arch:          req.Arch,
			CreatedAt:     createdAt,
		})
	}

	if err := model.BatchCreateClientEvents(events); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "failed to save events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// GetClientEventStats 获取事件统计（AdminAuth）
func GetClientEventStats(c *gin.Context) {
	startTime, endTime := parseTimePeriod(c)
	eventName := c.Query("event_name")
	eventNames := parseEventNames(c.Query("event_names"))
	// subdivide：按 event_data 中该 key 的取值细分单个事件。
	// 仅在锁定单个事件时有效（细分维度是按事件采样的）。
	subdivideKey := strings.TrimSpace(c.Query("subdivide"))
	targetEvent := eventName
	if targetEvent == "" && len(eventNames) == 1 {
		targetEvent = eventNames[0]
	}

	var (
		stats []model.ClientEventStats
		trend []model.ClientEventTrendPoint
		err   error
	)

	if subdivideKey != "" && targetEvent != "" {
		stats, err = model.GetClientEventStatsSubdivided(startTime, endTime, targetEvent, subdivideKey)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		trend, err = model.GetClientEventTrendSubdivided(startTime, endTime, targetEvent, subdivideKey)
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
		return
	}

	stats, err = model.GetClientEventStats(startTime, endTime, eventName, eventNames)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	trend, err = model.GetClientEventTrend(startTime, endTime, eventName, eventNames)
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

// GetClientEventFunnel 计算用户维度的逐层转化漏斗（AdminAuth）。
// layers 为 JSON 字符串:[{event,field,value}, ...]，顺序即漏斗层级。
func GetClientEventFunnel(c *gin.Context) {
	startTime, endTime := parseTimePeriod(c)
	raw := strings.TrimSpace(c.Query("layers"))
	if raw == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"layers": []model.FunnelLayerResult{}}})
		return
	}
	var layers []model.FunnelLayerSpec
	if err := json.Unmarshal([]byte(raw), &layers); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "layers 参数格式错误"})
		return
	}
	// 过滤无效层:必须有事件;选了字段则必须有取值
	valid := make([]model.FunnelLayerSpec, 0, len(layers))
	for _, l := range layers {
		if l.Event == "" || (l.Field != "" && l.Value == "") {
			continue
		}
		valid = append(valid, l)
	}
	if len(valid) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"layers": []model.FunnelLayerResult{}}})
		return
	}

	result, err := model.GetClientEventFunnel(startTime, endTime, valid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"layers": result}})
}

// GetClientEventList 获取事件明细列表（AdminAuth）
func GetClientEventList(c *gin.Context) {
	startTime, endTime := parseTimePeriod(c)
	eventName := c.Query("event_name")
	eventNames := parseEventNames(c.Query("event_names"))
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
	events, total, err := model.GetClientEventList(startTime, endTime, eventName, eventNames, username, offset, perPage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":      events,
			"total":      total,
			"page":       page,
			"per_page":   perPage,
			"totalPages": (total + int64(perPage) - 1) / int64(perPage),
		},
	})
}

// GetClientEventNames 返回最近一段时间内出现过的事件名列表（AdminAuth）
func GetClientEventNames(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}
	since := time.Now().AddDate(0, 0, -days)

	names, err := model.GetClientEventNames(since)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    names,
	})
}

// GetClientEventDataKeys 返回某事件 event_data 中可用作细分维度的顶层字段名（AdminAuth）
func GetClientEventDataKeys(c *gin.Context) {
	eventName := strings.TrimSpace(c.Query("event_name"))
	if eventName == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": []string{}})
		return
	}
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	if days < 1 || days > 365 {
		days = 30
	}
	since := time.Now().AddDate(0, 0, -days)

	keys, err := model.GetClientEventDataKeys(eventName, since, 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    keys,
	})
}

// parseTimePeriod 解析时间范围参数
func parseTimePeriod(c *gin.Context) (time.Time, time.Time) {
	period := c.DefaultQuery("period", "7d")
	now := time.Now()

	switch period {
	case "today":
		return now.Truncate(24 * time.Hour), now
	case "7d":
		return now.AddDate(0, 0, -7), now
	case "30d":
		return now.AddDate(0, 0, -30), now
	case "custom":
		startStr := c.Query("start")
		endStr := c.Query("end")
		startTime, err1 := time.Parse("2006-01-02", startStr)
		endTime, err2 := time.Parse("2006-01-02", endStr)
		if err1 == nil && err2 == nil {
			return startTime, endTime.Add(24*time.Hour - time.Second)
		}
	}

	return now.AddDate(0, 0, -7), now
}

// parseEventNames 解析逗号分隔的事件名列表
func parseEventNames(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}
