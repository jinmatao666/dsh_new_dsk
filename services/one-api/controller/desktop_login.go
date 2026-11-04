package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"net/http"
	"sync"
	"time"
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

var initialPasswordGrants = struct {
	sync.Mutex
	users map[int]time.Time
}{users: map[int]time.Time{}}

func grantInitialPassword(userID int) {
	initialPasswordGrants.Lock()
	defer initialPasswordGrants.Unlock()
	for id, expiry := range initialPasswordGrants.users {
		if time.Now().After(expiry) {
			delete(initialPasswordGrants.users, id)
		}
	}
	initialPasswordGrants.users[userID] = time.Now().Add(10 * time.Minute)
}

// SetInitialDesktopPassword permits one password setup immediately after verified phone registration.
func SetInitialDesktopPassword(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	if id <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	var input struct {
		Password string `json:"new_password"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.Password) < 8 || len(input.Password) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "密码长度需为8–20位"})
		return
	}
	initialPasswordGrants.Lock()
	defer initialPasswordGrants.Unlock()
	expiry, ok := initialPasswordGrants.users[id]
	if !ok || time.Now().After(expiry) {
		delete(initialPasswordGrants.users, id)
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "首次设置窗口已过期，请在账户设置中验证手机号后设置密码"})
		return
	}
	user, err := model.GetUserById(id, false)
	if err != nil || user.Status != model.UserStatusEnabled || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "账号状态异常，请重新登录"})
		return
	}
	if model.ACCOUNT_DB == nil || user.AccountId == nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "账号信息未就绪，请稍后在账户设置中设置密码"})
		return
	}
	var existing int64
	if err := model.ACCOUNT_DB.Model(&model.AccountCredential{}).Where("account_id = ? AND password_hash <> ?", user.AccountId, "").Count(&existing).Error; err != nil || existing > 0 {
		delete(initialPasswordGrants.users, id)
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "密码已设置，请在账户设置中验证后修改"})
		return
	}
	if err = model.WriteAccountCredentialByLocalUser(id, input.Password); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "密码保存失败，请稍后重试"})
		return
	}
	delete(initialPasswordGrants.users, id)
	c.JSON(http.StatusOK, gin.H{"success": true})
}
