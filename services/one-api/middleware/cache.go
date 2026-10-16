package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

func Cache() func(c *gin.Context) {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		// API / 动态接口不应被长缓存：否则临时错误响应（如 404 NoRoute）
		// 会被浏览器/WebView 缓存一周，后端修好后客户端仍返回旧的错误。
		if path == "/" || strings.HasPrefix(path, "/api") || strings.HasPrefix(path, "/v1") {
			c.Header("Cache-Control", "no-cache")
		} else {
			c.Header("Cache-Control", "max-age=604800") // one week（仅带 hash 的静态资源）
		}
		c.Next()
	}
}
