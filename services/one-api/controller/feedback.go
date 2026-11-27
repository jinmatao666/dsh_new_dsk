package controller

import (
	"encoding/json"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"unicode/utf8"

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
	if strings.TrimSpace(req.FeedbackType) == "deployment_inquiry" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false})
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
	var read *bool
	if raw, provided := c.GetQuery("read"); provided {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid read filter"})
			return
		}
		read = &value
	}
	list, total, err := model.GetFeedbackList(feedbackType, username, offset, perPage, read)
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

func CreateWebsiteDeploymentInquiry(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	var input struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Phone   string `json:"phone"`
		Details string `json:"details"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false})
		return
	}
	name, email, details := strings.TrimSpace(input.Name), strings.TrimSpace(input.Email), strings.TrimSpace(input.Details)
	phone := strings.TrimSpace(input.Phone)
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(email) > 254 || len(phone) > 32 || name == "" || utf8.RuneCountInString(name) > 80 || details == "" || utf8.RuneCountInString(details) > 2000 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false})
		return
	}
	inquiry := model.Feedback{Username: name, FeedbackType: "deployment_inquiry", Content: details, Context: email, Phone: phone}
	if err := model.CreateFeedback(&inquiry); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true})
}

func SetWebsiteDeploymentInquiryRead(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	var input struct {
		Read *bool `json:"read"`
	}
	if err != nil || id <= 0 || c.ShouldBindJSON(&input) != nil || input.Read == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false})
		return
	}
	result := model.DB.Model(&model.Feedback{}).Where("id = ? AND feedback_type = ?", id, "deployment_inquiry").Update("read", *input.Read)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
