package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"net/http"
)

// ReorderCatalog moves one item relative to another using the complete server list.
func ReorderCatalog(kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input struct {
			Key       string `json:"key"`
			TargetKey string `json:"target_key"`
			After     bool   `json:"after"`
		}
		if c.ShouldBindJSON(&input) != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "排序参数无效"})
			return
		}
		if err := model.MoveCatalogItem(kind, input.Key, input.TargetKey, input.After); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	}
}
