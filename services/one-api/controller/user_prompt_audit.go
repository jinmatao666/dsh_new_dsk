package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
)

// GetUserPromptAudits 仅限管理员：查看桌面端用户的文本问题、模型、额度和错误摘要。
func GetUserPromptAudits(c *gin.Context) {
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
	audits, err := model.GetUserPromptAudits(c.Query("keyword"), p*pageSize, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": audits})
}
