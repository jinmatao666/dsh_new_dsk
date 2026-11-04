package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAccountSMSWithoutCaptchaKeepsPublicChallengeAndRateLimit(t *testing.T) {
	oldSMS, oldCaptcha, oldMax := config.SMSEnabled, config.CaptchaEnabled, config.PhoneMaxSendPerHour
	config.SMSEnabled = true
	config.CaptchaEnabled = true
	config.PhoneMaxSendPerHour = 1
	phoneRateLimitMutex.Lock()
	previous, existed := phoneRateLimitMap["13912345678"]
	phoneRateLimitMap["13912345678"] = []time.Time{time.Now()}
	phoneRateLimitMutex.Unlock()
	t.Cleanup(func() {
		phoneRateLimitMutex.Lock()
		defer phoneRateLimitMutex.Unlock()
		if existed {
			phoneRateLimitMap["13912345678"] = previous
		} else {
			delete(phoneRateLimitMap, "13912345678")
		}
	})
	t.Cleanup(func() {
		config.SMSEnabled = oldSMS
		config.CaptchaEnabled = oldCaptcha
		config.PhoneMaxSendPerHour = oldMax
	})
	for _, authenticated := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"phone":"13912345678","purpose":"phone_bind"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		if authenticated {
			c.Set(ctxkey.Id, 123)
			SendAccountPhoneBindCode(c)
		} else {
			SendPhoneVerificationCode(c)
		}
		body := recorder.Body.String()
		if authenticated && !strings.Contains(body, "发送过于频繁") {
			t.Fatalf("authenticated request must reach rate limiter: %s", body)
		}
		if !authenticated && !strings.Contains(body, "验证码") {
			t.Fatalf("public request must keep graphical challenge: %s", body)
		}
	}
}
func TestAccountSMSRequiresLogin(t *testing.T) {
	old := config.SMSEnabled
	config.SMSEnabled = true
	t.Cleanup(func() { config.SMSEnabled = old })
	for _, handler := range []gin.HandlerFunc{SendAccountPhoneBindCode, SendResetPasswordCode, SendPhoneChangeCode} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("POST", "/", nil)
		handler(c)
		if recorder.Code != 401 {
			t.Fatalf("expected unauthorized: %d %s", recorder.Code, recorder.Body.String())
		}
	}
}
