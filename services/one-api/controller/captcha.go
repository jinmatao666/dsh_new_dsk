package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mojocn/base64Captcha"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/logger"
)

// captchaDriver 生成 5 位数字、带干扰线的图形验证码。
// 答案存入内存验证码 map（复用 common 的 verification 机制，10 分钟有效），不依赖 Redis。
var captchaDriver = base64Captcha.NewDriverDigit(50, 140, 5, 0.7, 80)

// GetCaptcha 生成图形验证码，返回 captcha_id 与 base64 PNG。
// 前端在「发送手机验证码」前展示图片并要求用户输入，提交时一并带上 captcha_id/captcha_code。
func GetCaptcha(c *gin.Context) {
	id, content, answer := captchaDriver.GenerateIdQuestionAnswer()
	item, err := captchaDriver.DrawCaptcha(content)
	if err != nil {
		logger.SysError("failed to draw captcha: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "图形验证码生成失败",
		})
		return
	}

	// 复用现有内存验证码存储（带 10 分钟 TTL），key 为 captcha id，purpose 区分用途
	common.RegisterVerificationCodeWithKey(id, answer, common.CaptchaPurpose)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"captcha_id":    id,
			"captcha_image": item.EncodeB64string(),
		},
	})
}
