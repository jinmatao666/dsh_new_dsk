package config

import (
	"os"
	"strconv"
)

// LoadSMSConfigFromEnv loads SMS configuration from environment variables
func LoadSMSConfigFromEnv() {
	// Load from environment variables
	if val := os.Getenv("SMS_ENABLED"); val != "" {
		SMSEnabled = val == "true"
	}

	if val := os.Getenv("SMS_PROVIDER"); val != "" {
		SMSProvider = val
	}

	if val := os.Getenv("SMS_ACCESS_KEY_ID"); val != "" {
		SMSAccessKeyId = val
	}

	if val := os.Getenv("SMS_ACCESS_KEY_SECRET"); val != "" {
		SMSAccessKeySecret = val
	}

	if val := os.Getenv("SMS_SIGN_NAME"); val != "" {
		SMSSignName = val
	}

	if val := os.Getenv("SMS_TEMPLATE_CODE"); val != "" {
		SMSTemplateCode = val
	}

	if val := os.Getenv("SMS_REGION"); val != "" {
		SMSRegion = val
	}

	if val := os.Getenv("PHONE_LOGIN_ENABLED"); val != "" {
		PhoneLoginEnabled = val == "true"
	}

	if val := os.Getenv("PHONE_REGISTER_ENABLED"); val != "" {
		PhoneRegisterEnabled = val == "true"
	}

	if val := os.Getenv("PHONE_VERIFICATION_CODE_LENGTH"); val != "" {
		if intVal, err := strconv.Atoi(val); err == nil {
			PhoneVerificationCodeLength = intVal
		}
	}

	if val := os.Getenv("PHONE_VERIFICATION_VALID_MINUTES"); val != "" {
		if intVal, err := strconv.Atoi(val); err == nil {
			PhoneVerificationValidMinutes = intVal
		}
	}

	if val := os.Getenv("PHONE_MAX_SEND_PER_HOUR"); val != "" {
		if intVal, err := strconv.Atoi(val); err == nil {
			PhoneMaxSendPerHour = intVal
		}
	}

	if val := os.Getenv("CAPTCHA_ENABLED"); val != "" {
		CaptchaEnabled = val == "true"
	}
}
