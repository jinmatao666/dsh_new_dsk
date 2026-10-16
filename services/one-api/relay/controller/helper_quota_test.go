package controller

import (
	"testing"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/stretchr/testify/assert"
)

func TestGetInsufficientQuotaMessageWithoutTopUpLinkFailsClosed(t *testing.T) {
	previous := config.TopUpLink
	t.Cleanup(func() { config.TopUpLink = previous })
	config.TopUpLink = ""

	message := getInsufficientQuotaMessage()
	assert.Equal(t, "用户额度不足，请联系管理员", message)
	assert.NotContains(t, message, "http")
}

func TestGetInsufficientQuotaMessageUsesConfiguredTopUpLink(t *testing.T) {
	previous := config.TopUpLink
	t.Cleanup(func() { config.TopUpLink = previous })
	config.TopUpLink = " https://private.example/top-up "

	assert.Equal(t, "用户额度不足，请 [立即充值](https://private.example/top-up)", getInsufficientQuotaMessage())
}
