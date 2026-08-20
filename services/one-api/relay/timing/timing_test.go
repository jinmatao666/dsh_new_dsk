package timing

import (
	"bytes"
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/helper"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// captureLogs 替换 gin 的 default writer，便于断言 logger 输出。
func captureLogs(t *testing.T) (*bytes.Buffer, func()) {
	t.Helper()
	buf := &bytes.Buffer{}
	prevDefault := gin.DefaultWriter
	prevErr := gin.DefaultErrorWriter
	gin.DefaultWriter = buf
	gin.DefaultErrorWriter = buf
	return buf, func() {
		gin.DefaultWriter = prevDefault
		gin.DefaultErrorWriter = prevErr
	}
}

// resetConfig 恢复 timing 相关配置到默认值（避免测试间相互影响）。
func resetConfig() {
	config.RelayTimingEnabled = true
	config.RelayTimingDetailEnabled = false
	config.RelayTimingSampleRate = 0
	config.RelayTimingSlowFirstChunkMs = 3000
	config.RelayTimingSlowTotalMs = 30000
}

func newGinCtx() *gin.Context {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	c.Set(helper.RequestIdKey, "req-test-1")
	return c
}

func TestStart_DisabledNoOp(t *testing.T) {
	resetConfig()
	defer resetConfig()
	config.RelayTimingEnabled = false

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	s := Start(c)
	if s == nil {
		t.Fatalf("expected non-nil state when disabled")
	}
	if s.Enabled {
		t.Fatalf("state should be disabled")
	}
	Mark(c, StageChannelSelected, F("channel_id", 7))
	Finish(c, "ok")

	if got := buf.String(); got != "" {
		t.Fatalf("expected no log output when disabled, got: %q", got)
	}
}

func TestStart_DefaultNoStageLogs(t *testing.T) {
	resetConfig()
	defer resetConfig()

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	Start(c)
	Mark(c, StageChannelSelected, F("channel_id", 7), F("channel_type", 1))
	Mark(c, StageUpstreamRequestStart)
	Mark(c, StageUpstreamResponseHeader, F("status_code", 200))

	out := buf.String()
	if strings.Contains(out, "relay timing stage=") {
		t.Fatalf("default mode should not emit stage logs, got: %q", out)
	}
}

func TestFinish_FastRequestNoSummary(t *testing.T) {
	resetConfig()
	defer resetConfig()

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	Start(c)
	Mark(c, StageChannelSelected, F("channel_id", 7))
	Mark(c, StageUpstreamRequestStart)
	Mark(c, StageUpstreamResponseHeader, F("status_code", 200))
	Mark(c, StageUpstreamFirstChunk, F("chunk_bytes", 32))
	Mark(c, StageClientFirstWrite)
	Finish(c, "ok")

	out := buf.String()
	if strings.Contains(out, "relay timing summary") {
		t.Fatalf("fast ok request should not emit summary, got: %q", out)
	}
}

func TestFinish_SlowFirstChunkEmitsSummary(t *testing.T) {
	resetConfig()
	defer resetConfig()
	// 把阈值设到 1ms 模拟慢请求
	config.RelayTimingSlowFirstChunkMs = 1

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	s := Start(c)
	// 手动倒拨时间，模拟首 chunk 已经过了若干毫秒
	s.RequestReceived = time.Now().Add(-100 * time.Millisecond)
	Mark(c, StageChannelSelected, F("channel_id", 7))
	Mark(c, StageUpstreamRequestStart)
	Mark(c, StageUpstreamResponseHeader, F("status_code", 200))
	Mark(c, StageUpstreamFirstChunk, F("chunk_bytes", 16))
	Mark(c, StageClientFirstWrite)
	Finish(c, "ok")

	out := buf.String()
	if !strings.Contains(out, "relay timing summary") {
		t.Fatalf("slow first chunk should emit summary, got: %q", out)
	}
	if !strings.Contains(out, "slow_reason=first_chunk") {
		t.Fatalf("expected slow_reason=first_chunk in summary, got: %q", out)
	}
	if !strings.Contains(out, "first_chunk_ms=") {
		t.Fatalf("expected first_chunk_ms in summary, got: %q", out)
	}
}

func TestFinish_ErrorAlwaysEmitsSummary(t *testing.T) {
	resetConfig()
	defer resetConfig()

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	Start(c)
	Mark(c, StageChannelSelected, F("channel_id", 7))
	Finish(c, "error", F("err", "do_request_failed"))

	out := buf.String()
	if !strings.Contains(out, "relay timing summary") {
		t.Fatalf("error finish should emit summary, got: %q", out)
	}
	if !strings.Contains(out, "status=error") {
		t.Fatalf("expected status=error, got: %q", out)
	}
}

func TestErrorBriefTruncatesAndStripsNewlines(t *testing.T) {
	long := strings.Repeat("a", 300) + "\nbody\rcontent\twith\ttabs"
	got := errorBrief(long)
	if len(got) > 200 {
		t.Fatalf("error brief should cap at 200 chars, got %d", len(got))
	}
	if strings.ContainsAny(got, "\n\r\t") {
		t.Fatalf("error brief should strip newlines/tabs, got: %q", got)
	}
}

func TestDetailMode_EmitsStageLogs(t *testing.T) {
	resetConfig()
	defer resetConfig()
	config.RelayTimingDetailEnabled = true

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	Start(c)
	Mark(c, StageChannelSelected, F("channel_id", 7))
	Finish(c, "ok")

	out := buf.String()
	if !strings.Contains(out, "stage=request_received") {
		t.Fatalf("detail mode should emit request_received stage, got: %q", out)
	}
	if !strings.Contains(out, "stage=channel_selected") {
		t.Fatalf("detail mode should emit channel_selected stage, got: %q", out)
	}
	if !strings.Contains(out, "stage=relay_finished") {
		t.Fatalf("detail mode should emit relay_finished stage, got: %q", out)
	}
}

func TestRetry_AppendsRetryAttempt(t *testing.T) {
	resetConfig()
	defer resetConfig()

	c := newGinCtx()
	s := Start(c)
	Mark(c, StageChannelSelected, F("channel_id", 7), F("channel_type", 1))
	if s.ChannelID != 7 || s.RetryCount != 0 {
		t.Fatalf("expected initial channel id 7 with no retry, got %+v", s)
	}
	// 模拟 retry 切到新 channel
	Mark(c, StageChannelSelected, F("channel_id", 9), F("channel_type", 2))
	if s.RetryCount != 1 {
		t.Fatalf("expected retry_count=1 after second channel selection, got %d", s.RetryCount)
	}
	if s.ChannelID != 9 {
		t.Fatalf("expected current channel id 9, got %d", s.ChannelID)
	}
	if len(s.RetryAttempts) != 1 {
		t.Fatalf("expected one retry attempt, got %d", len(s.RetryAttempts))
	}
}

func TestSampling_FullRateEmitsStage(t *testing.T) {
	resetConfig()
	defer resetConfig()
	config.RelayTimingSampleRate = 10000

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	Start(c)
	Mark(c, StageChannelSelected, F("channel_id", 7))
	Finish(c, "ok")

	if !strings.Contains(buf.String(), "stage=channel_selected") {
		t.Fatalf("100%% sampling should emit stage logs, got: %q", buf.String())
	}
}

func TestFinish_Idempotent(t *testing.T) {
	resetConfig()
	defer resetConfig()
	config.RelayTimingSlowTotalMs = 1

	buf, restore := captureLogs(t)
	defer restore()

	c := newGinCtx()
	s := Start(c)
	s.RequestReceived = time.Now().Add(-50 * time.Millisecond)
	Finish(c, "ok")
	first := buf.String()
	Finish(c, "ok")
	second := buf.String()
	// 第二次 Finish 不应再追加 summary
	if strings.Count(second, "relay timing summary") != strings.Count(first, "relay timing summary") {
		t.Fatalf("second Finish should be no-op, got first=%q second=%q", first, second)
	}
}

func TestGetFromContext(t *testing.T) {
	resetConfig()
	defer resetConfig()

	c := newGinCtx()
	s := Start(c)
	if s == nil {
		t.Fatalf("expected non-nil state from Start")
	}

	got := GetFromContext(c.Request.Context())
	if got == nil {
		t.Fatalf("expected GetFromContext to return state from request context")
	}
	if got != s {
		t.Fatalf("expected same *State pointer, got %p want %p", got, s)
	}

	if GetFromContext(nil) != nil {
		t.Fatalf("expected nil for nil context")
	}

	if GetFromContext(context.Background()) != nil {
		t.Fatalf("expected nil for context without state")
	}
}
