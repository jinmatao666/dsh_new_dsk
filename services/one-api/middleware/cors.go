package middleware

import (
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
)

func corsAllowedOrigins() map[string]struct{} {
	raw := strings.TrimSpace(os.Getenv("CORS_ALLOW_ORIGINS"))
	if raw == "" && config.DeploymentMode() == "private" {
		raw = "http://tauri.localhost,tauri://localhost"
	}
	origins := map[string]struct{}{}
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value != "" {
			origins[value] = struct{}{}
		}
	}
	return origins
}

func CORS() gin.HandlerFunc {
	corsConfig := cors.DefaultConfig()
	allowedOrigins := corsAllowedOrigins()
	privateDeployment := config.DeploymentMode() == "private"
	corsConfig.AllowOriginFunc = func(origin string) bool {
		if !privateDeployment && len(allowedOrigins) == 0 {
			return true
		}
		_, ok := allowedOrigins[origin]
		return ok
	}
	corsConfig.AllowCredentials = true
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Content-Type", "Authorization", "X-Requested-With", "Accept-Language"}
	corsConfig.ExposeHeaders = []string{"Content-Length", "Content-Type", "X-Oneapi-Request-Id", "X-Parvis-Request-Id"}
	return cors.New(corsConfig)
}
