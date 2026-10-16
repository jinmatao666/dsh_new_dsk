package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
)

func RequireRemoteSkills() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !config.DeploymentCapabilities()[config.CapabilityRemoteSkills] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "当前部署未启用远程 Skill 能力",
			})
			return
		}
		c.Next()
	}
}
