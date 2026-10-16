package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/stretchr/testify/assert"
)

func TestSkillInjectSkipsRemoteSkillsWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PARVIS_CAPABILITIES", "ocr")

	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	request.Header.Set("X-Parvis-Skills", "must-not-be-read:public")
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = request

	SkillInject()(c)

	assert.Empty(t, c.GetString(ctxkey.SkillUserPrompt))
	assert.Empty(t, c.GetString(ctxkey.SystemPrompt))
	assert.Empty(t, request.Header.Get("X-Parvis-Skills"))
}
