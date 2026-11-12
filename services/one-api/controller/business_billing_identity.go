package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/blacklist"
	"github.com/songquanpeng/one-api/model"
	"strings"
	"time"
)

// BusinessBillingAuth accepts existing platform auth or a server-only context from expert identity exchange.
func BusinessBillingAuth(userAuth gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !strings.HasPrefix(token, "wbc_") {
			userAuth(c)
			return
		}
		if !strings.HasPrefix(c.GetHeader("Authorization"), "Bearer ") {
			c.AbortWithStatusJSON(401, gin.H{"success": false, "code": "BILLING_CONTEXT_EXPIRED"})
			return
		}
		var scope model.BusinessBillingContext
		if model.DB.Where("hash = ? AND expires_at > ?", model.BillingDigest(token), time.Now()).First(&scope).Error != nil {
			c.AbortWithStatusJSON(401, gin.H{"success": false, "code": "BILLING_CONTEXT_EXPIRED", "message": "请重新打开专家"})
			return
		}
		var expert model.ExpertWebProfile
		if model.DB.Where(map[string]interface{}{"key": scope.ExpertKey, "published": true, "provider_secret_hash": scope.ProviderHash}).First(&expert).Error != nil {
			c.AbortWithStatusJSON(403, gin.H{"success": false, "code": "BILLING_CONTEXT_REVOKED"})
			return
		}
		var user model.User
		if model.DB.First(&user, scope.UserID).Error != nil || user.Status == model.UserStatusDisabled || blacklist.IsUserBanned(scope.UserID) {
			c.AbortWithStatusJSON(403, gin.H{"success": false, "code": "BILLING_CONTEXT_REVOKED"})
			return
		}
		c.Set("id", scope.UserID)
		c.Set("billing.context", scope)
		c.Next()
	}
}
