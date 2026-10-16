package middleware

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// MCPInternalAuth protects token introspection from direct client access. The
// MCP service sends the shared key only over the server-side network.
func MCPInternalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		expected := strings.TrimSpace(os.Getenv("PARVIS_MCP_INTERNAL_KEY"))
		provided := strings.TrimSpace(c.GetHeader("X-Parvis-Internal-Key"))
		if expected == "" {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"message": "MCP internal authentication is not configured",
			})
			return
		}
		if len(expected) != len(provided) ||
			subtle.ConstantTimeCompare([]byte(expected), []byte(provided)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "unauthorized",
			})
			return
		}
		c.Next()
	}
}
