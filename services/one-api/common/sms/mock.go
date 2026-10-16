package sms

import (
	"github.com/songquanpeng/one-api/common/logger"
)

// MockProvider is a development-only SMS provider that does not actually send
// SMS. It writes the verification code to the server log so that local testing
// (e.g. activity configuration with phone register/login) can proceed without
// spending real SMS quota or owning the target phone number.
//
// Enable it by setting SMS_PROVIDER=mock in .env. Never use in production.
type MockProvider struct{}

func NewMockProvider() *MockProvider {
	return &MockProvider{}
}

func (p *MockProvider) SendVerificationCode(phone, code string) error {
	logger.SysLog("[SMS MOCK] verification code for " + phone + " is: " + code)
	return nil
}
