package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"net/http"
)

// DesktopAuthCapabilities publishes enabled login methods and registration policy without credentials.
func DesktopAuthCapabilities(c *gin.Context) {
	config.OptionMapRWMutex.RLock()
	agreement, privacy := config.OptionMap["RegistrationAgreementText"], config.OptionMap["RegistrationPrivacyText"]
	config.OptionMapRWMutex.RUnlock()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"sms":      config.SMSEnabled && config.PhoneLoginEnabled,
		"reset":    config.SMSEnabled,
		"register": config.RegisterEnabled && config.PhoneRegisterEnabled,
		"wechat":   config.WeChatAuthEnabled && config.WeChatAppID != "" && config.WeChatAppSecret != "",
		"captcha":  config.CaptchaEnabled, "agreement": agreement, "privacy": privacy,
	}})
}
