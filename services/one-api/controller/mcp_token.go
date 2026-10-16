package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

func ValidateMCPToken(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	tokenId := c.GetInt(ctxkey.TokenId)
	user, err := model.GetUserById(userId, false)
	if err != nil || user.Status != model.UserStatusEnabled {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "invalid user"})
		return
	}
	token, err := model.GetTokenByIds(tokenId, userId)
	if err != nil || token.Status != model.TokenStatusEnabled {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "invalid token"})
		return
	}
	remaining := token.RemainQuota
	if token.UnlimitedQuota {
		remaining = -1
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"user_id":         user.Id,
			"username":        user.Username,
			"remaining_quota": remaining,
		},
	})
}
