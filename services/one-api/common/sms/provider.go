package sms

import (
	"errors"
	"github.com/songquanpeng/one-api/common/config"
)

// SMSProvider defines the interface for SMS service providers
type SMSProvider interface {
	SendVerificationCode(phone, code string) error
}

// GetProvider returns the configured SMS provider
func GetProvider() (SMSProvider, error) {
	if !config.SMSEnabled {
		return nil, errors.New("SMS service is not enabled")
	}

	switch config.SMSProvider {
	case "aliyun":
		return NewAliyunProvider(
			config.SMSAccessKeyId,
			config.SMSAccessKeySecret,
			config.SMSSignName,
			config.SMSTemplateCode,
			config.SMSRegion,
		)
	case "mock":
		// Development-only: logs the code instead of sending real SMS.
		return NewMockProvider(), nil
	default:
		return nil, errors.New("unsupported SMS provider: " + config.SMSProvider)
	}
}
