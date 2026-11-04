package common

import (
	"github.com/songquanpeng/one-api/common/config"
	"testing"
	"time"
)

func TestPhoneVerificationUsesConfiguredLifetime(t *testing.T) {
	old := config.PhoneVerificationValidMinutes
	config.PhoneVerificationValidMinutes = 5
	t.Cleanup(func() {
		config.PhoneVerificationValidMinutes = old
		DeletePhoneVerificationCode("13800138000", PhoneLoginPurpose)
	})
	verificationMutex.Lock()
	verificationMap[PhoneLoginPurpose+"13800138000"] = verificationValue{code: "123456", time: time.Now().Add(-6 * time.Minute)}
	verificationMutex.Unlock()
	if VerifyPhoneCode("13800138000", "123456", PhoneLoginPurpose) {
		t.Fatal("expired SMS accepted")
	}
	RegisterPhoneVerificationCode("13800138000", PhoneLoginPurpose, "123456")
	if !VerifyPhoneCode("13800138000", "123456", PhoneLoginPurpose) || VerifyPhoneCode("13800138000", "000000", PhoneLoginPurpose) || VerifyPhoneCode("13800138000", "123456", PhoneBindPurpose) {
		t.Fatal("code or purpose validation failed")
	}
	verificationMutex.Lock()
	sent := verificationMap[PhoneLoginPurpose+"13800138000"]
	sent.time = time.Now().Add(-6 * time.Minute)
	verificationMap[PhoneLoginPurpose+"13800138000"] = sent
	verificationMutex.Unlock()
	config.PhoneVerificationValidMinutes = 10
	if VerifyPhoneCode("13800138000", "123456", PhoneLoginPurpose) {
		t.Fatal("configuration change revived an expired code")
	}

}
