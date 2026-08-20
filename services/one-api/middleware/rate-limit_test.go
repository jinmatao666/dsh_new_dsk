package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
)

// fire 走一次限流中间件，返回是否被拦截（429）。读 gin 记录的 Writer.Status()
// 而非 httptest.Recorder.Code：gin 会缓冲状态码直到 flush，中间件 Abort 后若无
// body 写入，Recorder.Code 仍是默认 200，只有 Writer.Status() 反映真实状态。
func fire(mw func(c *gin.Context), userID int) bool {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/skill/1/bundle", nil)
	if userID > 0 {
		c.Set(ctxkey.Id, userID)
	}
	mw(c)
	return c.Writer.Status() == http.StatusTooManyRequests
}

func TestSkillBundleRateLimit_blocksOverLimitPerUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	common.RedisEnabled = false
	config.DebugEnabled = false

	// 限额 2 次/60s，按用户区分（mark 唯一，避免与其他用例共享内存桶）。
	mw := rateLimitFactoryWith(2, 60, "TESTSB1", userIdentifier)

	// 同一用户：前 2 次放行，第 3 次拦截。
	assert.False(t, fire(mw, 42))
	assert.False(t, fire(mw, 42))
	assert.True(t, fire(mw, 42), "第 3 次应触发 429")

	// 另一个用户走独立的桶，不受上面影响。
	assert.False(t, fire(mw, 99), "不同账号应有独立限流桶")
}

func TestSkillBundleRateLimit_disabledInDebug(t *testing.T) {
	gin.SetMode(gin.TestMode)
	common.RedisEnabled = false
	config.DebugEnabled = true
	defer func() { config.DebugEnabled = false }()

	mw := rateLimitFactoryWith(1, 60, "TESTSB2", userIdentifier)
	// Debug 模式下限流为 no-op，多次调用都不应拦截。
	assert.False(t, fire(mw, 7))
	assert.False(t, fire(mw, 7))
	assert.False(t, fire(mw, 7))
}
