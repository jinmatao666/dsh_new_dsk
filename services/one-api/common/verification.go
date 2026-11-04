package common

import (
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/config"
	"strings"
	"sync"
	"time"
)

type verificationValue struct {
	code     string
	time     time.Time
	lifetime time.Duration
}

const (
	EmailVerificationPurpose  = "v"
	PasswordResetPurpose      = "r"
	PhoneLoginPurpose         = "phone_login"
	PhoneRegisterPurpose      = "phone_register"
	PhoneBindPurpose          = "phone_bind"
	PhoneChangePurpose        = "phone_change"
	PhoneResetPasswordPurpose = "phone_reset_password"
	CaptchaPurpose            = "captcha"
)

var verificationMutex sync.Mutex
var verificationMap map[string]verificationValue
var verificationMapMaxSize = 10
var VerificationValidMinutes = 10

func GenerateVerificationCode(length int) string {
	code := uuid.New().String()
	code = strings.Replace(code, "-", "", -1)
	if length == 0 {
		return code
	}
	return code[:length]
}

func RegisterVerificationCodeWithKey(key string, code string, purpose string) {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	minutes := VerificationValidMinutes
	if strings.HasPrefix(purpose, "phone_") && config.PhoneVerificationValidMinutes > 0 {
		minutes = config.PhoneVerificationValidMinutes
	}
	verificationMap[purpose+key] = verificationValue{
		code:     code,
		time:     time.Now(),
		lifetime: time.Duration(minutes) * time.Minute,
	}
	if len(verificationMap) > verificationMapMaxSize {
		removeExpiredPairs()
	}
}

func VerifyCodeWithKey(key string, code string, purpose string) bool {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	value, okay := verificationMap[purpose+key]
	now := time.Now()
	if !okay || int(now.Sub(value.time).Seconds()) >= VerificationValidMinutes*60 {
		return false
	}
	return code == value.code
}

func DeleteKey(key string, purpose string) {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	delete(verificationMap, purpose+key)
}

// no lock inside, so the caller must lock the verificationMap before calling!
func removeExpiredPairs() {
	now := time.Now()
	for key := range verificationMap {
		value := verificationMap[key]
		lifetime := value.lifetime
		if lifetime <= 0 {
			lifetime = time.Duration(VerificationValidMinutes) * time.Minute
		}
		if now.Sub(value.time) >= lifetime {
			delete(verificationMap, key)
		}
	}
}

func init() {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	verificationMap = make(map[string]verificationValue)
}

// GeneratePhoneVerificationCode generates a numeric verification code for phone
func GeneratePhoneVerificationCode(length int) string {
	if length <= 0 {
		length = 6
	}
	code := ""
	for i := 0; i < length; i++ {
		code += string(rune('0' + (uuid.New().ID() % 10)))
	}
	return code
}

// RegisterPhoneVerificationCode registers a phone verification code
func RegisterPhoneVerificationCode(phone string, purpose string, code string) {
	RegisterVerificationCodeWithKey(phone, code, purpose)
}

// VerifyPhoneCode verifies a phone verification code
func VerifyPhoneCode(phone string, code string, purpose string) bool {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	value, okay := verificationMap[purpose+phone]
	lifetime := value.lifetime
	if lifetime <= 0 {
		minutes := config.PhoneVerificationValidMinutes
		if minutes <= 0 {
			minutes = 5
		}
		lifetime = time.Duration(minutes) * time.Minute
	}
	return okay && time.Since(value.time) < lifetime && code == value.code
}

// DeletePhoneVerificationCode deletes a phone verification code
func DeletePhoneVerificationCode(phone string, purpose string) {
	DeleteKey(phone, purpose)
}
