package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/i18n"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/sms"
	"github.com/songquanpeng/one-api/model"
)

// Phone rate limiting
var phoneRateLimitMap = make(map[string][]time.Time)
var phoneRateLimitMutex sync.Mutex

type SendPhoneCodeRequest struct {
	Phone       string `json:"phone" binding:"required"`
	Purpose     string `json:"purpose" binding:"required"`
	CaptchaId   string `json:"captcha_id"`
	CaptchaCode string `json:"captcha_code"`
}

type PhoneLoginRequest struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

type PhoneRegisterRequest struct {
	Phone    string `json:"phone" binding:"required"`
	Code     string `json:"code" binding:"required"`
	Password string `json:"password"`
	AffCode  string `json:"aff_code"`
	Username string `json:"username"` // 可选；为空时默认使用规范化后的手机号作为登录用户名
	// UseLoginSMS 为 true 时，允许使用「登录」用途短信验证码完成注册（须号码未注册；用于登录页引导弹窗，避免二次发短信）
	UseLoginSMS bool `json:"use_login_sms"`
}

// validateE164Phone validates Chinese mainland mobile number (11 digits)
func validateE164Phone(phone string) bool {
	pattern := `^1[3-9]\d{9}$`
	matched, _ := regexp.MatchString(pattern, phone)
	return matched
}

// normalizePhone normalizes phone number for China mainland only.
// Supported inputs:
// - 13800138000
// - +8613800138000
// - 8613800138000
// Output:
// - 13800138000
func normalizePhone(phone string) string {
	// Remove spaces and dashes
	phone = strings.ReplaceAll(phone, " ", "")
	phone = strings.ReplaceAll(phone, "-", "")

	if strings.HasPrefix(phone, "+86") && len(phone) == 14 {
		return phone[3:]
	}

	if strings.HasPrefix(phone, "86") && len(phone) == 13 {
		return phone[2:]
	}

	return phone
}

// hashPhone hashes phone number for logging (privacy protection)
func hashPhone(phone string) string {
	hash := sha256.Sum256([]byte(phone))
	return hex.EncodeToString(hash[:])[:16]
}

// checkPhoneRateLimit checks if phone number exceeds rate limit
func checkPhoneRateLimit(phone string) bool {
	phoneRateLimitMutex.Lock()
	defer phoneRateLimitMutex.Unlock()

	now := time.Now()
	oneHourAgo := now.Add(-time.Hour)

	// Clean up old entries
	if times, exists := phoneRateLimitMap[phone]; exists {
		var validTimes []time.Time
		for _, t := range times {
			if t.After(oneHourAgo) {
				validTimes = append(validTimes, t)
			}
		}
		phoneRateLimitMap[phone] = validTimes

		// Check if exceeds limit
		if len(validTimes) >= config.PhoneMaxSendPerHour {
			return false
		}
	}

	// Add current time
	phoneRateLimitMap[phone] = append(phoneRateLimitMap[phone], now)
	return true
}

// verifyCaptcha 校验图形验证码。
// 当 config.CaptchaEnabled 为 false 时直接放行（向后兼容）。
// 校验成功后立即删除，防止同一图形验证码被重复使用。
func verifyCaptcha(captchaId string, captchaCode string) (bool, string) {
	if !config.CaptchaEnabled {
		return true, ""
	}
	if captchaId == "" || captchaCode == "" {
		return false, "请输入图形验证码"
	}
	if !common.VerifyCodeWithKey(captchaId, captchaCode, common.CaptchaPurpose) {
		return false, "图形验证码错误或已过期"
	}
	common.DeleteKey(captchaId, common.CaptchaPurpose)
	return true, ""
}

// SendPhoneVerificationCode sends SMS verification code
func SendPhoneVerificationCode(c *gin.Context) {
	if !config.SMSEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信服务未启用",
		})
		return
	}

	var req SendPhoneCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	// Normalize phone number (auto add +86 for Chinese numbers)
	req.Phone = normalizePhone(req.Phone)

	// Validate phone format
	if !validateE164Phone(req.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "手机号格式不正确",
		})
		return
	}

	// Verify graphical captcha (human verification) before sending SMS
	if ok, msg := verifyCaptcha(req.CaptchaId, req.CaptchaCode); !ok {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": msg,
		})
		return
	}

	// Validate purpose
	validPurposes := map[string]bool{
		common.PhoneLoginPurpose:         config.PhoneLoginEnabled,
		common.PhoneRegisterPurpose:      config.PhoneRegisterEnabled,
		common.PhoneBindPurpose:          true,
		common.PhoneChangePurpose:        true,
		common.PhoneResetPasswordPurpose: true,
	}

	if !validPurposes[req.Purpose] {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "不支持的验证码用途",
		})
		return
	}

	// Check rate limit
	if !checkPhoneRateLimit(req.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("发送过于频繁，每小时最多发送 %d 次", config.PhoneMaxSendPerHour),
		})
		return
	}

	// Check if phone already registered (for register purpose)
	if req.Purpose == common.PhoneRegisterPurpose {
		if model.IsPhoneAlreadyTaken(req.Phone) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "该手机号已被注册",
			})
			return
		}
	}

	// For phone login, code can be sent first. Whether phone is bound
	// will be checked during login submission.

	// Generate verification code
	code := common.GeneratePhoneVerificationCode(config.PhoneVerificationCodeLength)

	// Send SMS
	provider, err := sms.GetProvider()
	if err != nil {
		logger.SysError(fmt.Sprintf("failed to get SMS provider: %s", err.Error()))
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信服务暂时不可用",
		})
		return
	}

	err = provider.SendVerificationCode(req.Phone, code)
	if err != nil {
		logger.SysError(fmt.Sprintf("failed to send SMS to %s: %s", hashPhone(req.Phone), err.Error()))
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信发送失败，请稍后重试",
		})
		return
	}

	// Register verification code
	common.RegisterPhoneVerificationCode(req.Phone, req.Purpose, code)

	logger.SysLog(fmt.Sprintf("SMS sent to %s for purpose: %s", hashPhone(req.Phone), req.Purpose))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "验证码已发送",
	})
}

// PhoneLogin handles phone number login
func PhoneLogin(c *gin.Context) {
	ctx := c.Request.Context()
	if !config.PhoneLoginEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员关闭了手机号登录",
		})
		return
	}

	var req PhoneLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	// Normalize phone number (auto add +86 for Chinese numbers)
	req.Phone = normalizePhone(req.Phone)

	// Validate phone format
	if !validateE164Phone(req.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "手机号格式不正确",
		})
		return
	}

	// Verify code
	if !common.VerifyPhoneCode(req.Phone, req.Code, common.PhoneLoginPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}

	// 仅允许已绑定该手机号的用户登录；新用户请走 /api/user/phone/register 并单独获取「注册」验证码
	user := &model.User{}
	err := user.FillUserByPhone(req.Phone)
	if err != nil {
		msg := "该手机号尚未注册。请切换到「短信注册」并获取注册验证码以创建账号；若已有账号请用密码或微信登录，并在个人中心绑定手机号。"
		if !config.RegisterEnabled || !config.PhoneRegisterEnabled {
			msg = "该手机号尚未注册，且当前未开放手机号注册。请使用密码或微信登录已有账号；登录后可在个人中心绑定该手机号。"
		}
		c.JSON(http.StatusOK, gin.H{
			"success":          false,
			"code":             "phone_not_registered",
			"register_enabled": config.RegisterEnabled && config.PhoneRegisterEnabled,
			"message":          msg,
		})
		return
	}

	// Check user status
	if user.Status != model.UserStatusEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户已被封禁",
		})
		return
	}

	// Delete verification code
	common.DeletePhoneVerificationCode(req.Phone, common.PhoneLoginPurpose)

	// Log login
	model.RecordLog(ctx, user.Id, model.LogTypeBehavior, "通过手机号登录")

	// Setup session
	SetupLogin(user, c)
}

// PhoneRegister handles phone number registration
func PhoneRegister(c *gin.Context) {
	ctx := c.Request.Context()
	if !config.RegisterEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员关闭了新用户注册",
		})
		return
	}

	if !config.PhoneRegisterEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员关闭了手机号注册",
		})
		return
	}

	var req PhoneRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	// Normalize phone number (auto add +86 for Chinese numbers)
	req.Phone = normalizePhone(req.Phone)

	if req.Password != "" && (len(req.Password) < 8 || len(req.Password) > 20) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "密码长度需为 8-20 位",
		})
		return
	}

	// Validate phone format
	if !validateE164Phone(req.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "手机号格式不正确",
		})
		return
	}

	verifyRegister := common.VerifyPhoneCode(req.Phone, req.Code, common.PhoneRegisterPurpose)
	verifyLogin := false
	if req.UseLoginSMS {
		verifyLogin = common.VerifyPhoneCode(req.Phone, req.Code, common.PhoneLoginPurpose)
	}
	if !verifyRegister && !verifyLogin {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}
	codePurpose := common.PhoneRegisterPurpose
	if verifyRegister {
		codePurpose = common.PhoneRegisterPurpose
	} else {
		codePurpose = common.PhoneLoginPurpose
	}

	// Check if phone already taken
	if model.IsPhoneAlreadyTaken(req.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该手机号已被注册",
		})
		return
	}

	// Get inviter ID
	inviterId, _ := model.GetUserIdByAffCode(req.AffCode)

	// 登录用户名为手机号（11 位，符合 model 中 username 长度上限）
	username := strings.TrimSpace(req.Username)
	if username == "" {
		username = req.Phone
	}
	if username != req.Phone {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "当前仅支持使用手机号作为登录账号",
		})
		return
	}

	user := &model.User{
		Username:      username,
		DisplayName:   "P_" + req.Phone,
		Password:      req.Password,
		Phone:         req.Phone,
		PhoneVerified: true,
		InviterId:     inviterId,
	}

	if err := user.Insert(ctx, inviterId); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 异步触发注册邀请活动
	if req.AffCode != "" {
		affCode := req.AffCode
		userId := user.Id
		go func() {
			if err := model.TriggerInviteActivities(ctx, "registration", userId, affCode, "", 0); err != nil {
				logger.SysError(fmt.Sprintf("触发手机注册邀请活动失败 user=%d: %v", userId, err))
			}
		}()
	}

	common.DeletePhoneVerificationCode(req.Phone, codePurpose)
	model.RecordLog(ctx, user.Id, model.LogTypeBehavior, "通过手机号注册")
	SetupLogin(user, c)
}

type ResetPasswordByPhonePublicRequest struct {
	Phone       string `json:"phone" binding:"required"`
	Code        string `json:"code" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

// ResetPasswordByPhonePublic 登录前通过已绑定手机号 + 短信验证码重置密码。
// 与 ResetPasswordByPhone(登录后,从 session 取号)不同,这里手机号来自请求,
// 公开访问,故需校验短信验证码用途为 phone_reset_password。
func ResetPasswordByPhonePublic(c *gin.Context) {
	var req ResetPasswordByPhonePublicRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	req.Phone = normalizePhone(req.Phone)
	if !validateE164Phone(req.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "手机号格式不正确",
		})
		return
	}

	// 校验短信验证码(重置用途)
	if !common.VerifyPhoneCode(req.Phone, req.Code, common.PhoneResetPasswordPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}

	// 校验新密码长度
	if len(req.NewPassword) < 8 || len(req.NewPassword) > 20 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "密码长度应在 8-20 位之间",
		})
		return
	}

	// 查找该手机号对应的账号
	user := &model.User{}
	if err := user.FillUserByPhone(req.Phone); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该手机号尚未注册",
		})
		return
	}

	if user.Status != model.UserStatusEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户已被封禁",
		})
		return
	}

	// 更新密码(Update(true) 会同步账号中心改密)
	updateUser := model.User{
		Id:       user.Id,
		Password: req.NewPassword,
	}
	if err := updateUser.Update(true); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "密码重置失败：" + err.Error(),
		})
		return
	}

	common.DeletePhoneVerificationCode(req.Phone, common.PhoneResetPasswordPurpose)
	logger.SysLog(fmt.Sprintf("password reset via phone for %s", hashPhone(req.Phone)))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "密码重置成功",
	})
}
