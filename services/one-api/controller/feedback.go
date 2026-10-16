package controller

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// feedbackRequest 客户端提交体：images 为 base64 data-URL 数组，需单独接收后 JSON 编码入库
type feedbackRequest struct {
	Username     string   `json:"username"`
	FeedbackType string   `json:"feedback_type"`
	Content      string   `json:"content"`
	AppVersion   string   `json:"app_version"`
	Context      string   `json:"context"`
	Images       []string `json:"images"`
}

func CreateFeedback(c *gin.Context) {
	var req feedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}
	if req.Content == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "content is required",
		})
		return
	}

	feedback := model.Feedback{
		Username:     req.Username,
		FeedbackType: req.FeedbackType,
		Content:      req.Content,
		AppVersion:   req.AppVersion,
		Context:      req.Context,
	}
	if len(req.Images) > 0 {
		if encoded, err := json.Marshal(req.Images); err == nil {
			feedback.Images = string(encoded)
		}
	}

	if err := model.CreateFeedback(&feedback); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    feedback,
	})
}

// GetFeedbackList 获取用户反馈明细列表（AdminAuth）
func GetFeedbackList(c *gin.Context) {
	feedbackType := c.Query("feedback_type")
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
	list, total, err := model.GetFeedbackList(feedbackType, username, offset, perPage)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":      list,
			"total":      total,
			"page":       page,
			"per_page":   perPage,
			"totalPages": (total + int64(perPage) - 1) / int64(perPage),
		},
	})
}
