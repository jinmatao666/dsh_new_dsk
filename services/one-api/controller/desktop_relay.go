package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/resourcerelay"
	"net/http"
)

var desktopRelay = resourcerelay.New()

// DesktopResourceTunnel forwards authenticated desktop traffic only when an
// administrator has enabled the managed tunnel resource source.
func DesktopResourceTunnel(c *gin.Context) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	settings, err := parseDesktopDeploymentSettings(raw)
	if err != nil || settings.Network != "intranet" || settings.Resources == nil || settings.Resources.Source != "proxy" || settings.Resources.Transport != "tunnel" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "联网中转通道未启用"})
		return
	}
	limits, err := resourcerelay.EnvironmentLimits()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "中转服务限制配置无效"})
		return
	}
	desktopRelay.Serve(c.Writer, c.Request, c.GetInt("id"), limits)
}
