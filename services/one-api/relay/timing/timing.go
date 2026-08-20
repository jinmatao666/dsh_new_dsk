package timing

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
)

// Get 返回 gin.Context 中的 *State，没有则返回 nil。
func Get(c *gin.Context) *State {
	if c == nil {
		return nil
	}
	v, ok := c.Get(ContextKey)
	if !ok {
		return nil
	}
	s, _ := v.(*State)
	return s
}

// GetFromContext 从 context.Context 中取 State。
// 用于 goroutine 场景（postConsumeQuota 等），那里只有 context.Context、没有 gin.Context。
func GetFromContext(ctx context.Context) *State {
	if ctx == nil {
		return nil
	}
	v := ctx.Value(ContextKey)
	if v == nil {
		return nil
	}
	s, _ := v.(*State)
	return s
}

// SetRequestInfo 把请求级别的元数据（model 名、是否流式）补入 state，供 summary 使用。
// 调用时机：getAndValidateTextRequest + meta 解析完成后。
func SetRequestInfo(c *gin.Context, originModel, actualModel string, stream bool) {
	s := Get(c)
	if s == nil || !s.Enabled {
		return
	}
	if originModel != "" {
		s.OriginModel = originModel
	}
	if actualModel != "" {
		s.ActualModel = actualModel
	}
	s.Stream = stream
}

// Start 在请求进入 relay 时初始化 timing state，并标记 request_received。
// 默认 RelayTimingEnabled=true 时启用；禁用时仅放置一个 disabled 状态实例，
// 后续 Mark/Finish 会成为 no-op。
func Start(c *gin.Context) *State {
	if c == nil {
		return nil
	}
	now := time.Now()
	s := &State{
		Enabled:         config.RelayTimingEnabled,
		Detail:          config.RelayTimingDetailEnabled,
		Sampled:         shouldSample(config.RelayTimingSampleRate),
		RequestID:       c.GetString(helper.RequestIdKey),
		UserID:          c.GetInt(ctxkey.Id),
		Stream:          false,
		RequestReceived: now,
	}
	c.Set(ContextKey, s)
	if c.Request != nil {
		c.Request = c.Request.WithContext(
			context.WithValue(c.Request.Context(), ContextKey, s),
		)
	}
	if !s.Enabled {
		return s
	}
	if s.Detail || s.Sampled {
		emitStage(c, s, StageRequestReceived, now, nil)
	}
	return s
}

// Mark 标记一个阶段事件。State 不存在或未启用时直接返回。
//
// 行为：
//   - 写入对应阶段时间字段（首次或最后一次，依阶段语义）。
//   - 如果 Detail 或 Sampled，输出一行阶段日志。
//   - 不在首包路径里拼复杂字符串。
func Mark(c *gin.Context, stage Stage, fields ...Field) {
	s := Get(c)
	if s == nil || !s.Enabled {
		return
	}
	now := time.Now()
	applied := applyStage(s, stage, now, fields)
	// upstream_first_chunk / client_first_write 在流式响应里会被反复调用，
	// 但每个 relay 只关心"第一次"——applyStage 已经做了"只记录一次"的保护，
	// 这里同步只在该次调用真正生效时输出一行 stage 日志，避免刷屏。
	if !applied {
		return
	}
	if s.Detail || s.Sampled {
		emitStage(c, s, stage, now, fields)
	}
}

// Finish 在 relay 完成时调用，写入完成时间并按需输出 summary。
// status 通常为 "ok" / "error" / "client_canceled"。
func Finish(c *gin.Context, status string, fields ...Field) {
	s := Get(c)
	if s == nil || !s.Enabled {
		return
	}
	if s.finished {
		return
	}
	s.finished = true
	now := time.Now()
	s.RelayFinished = now
	if s.Status == "" {
		s.Status = status
	} else if status != "" {
		s.Status = status
	}
	for _, f := range fields {
		switch f.Key {
		case "status_code":
			// status_code 在阶段事件里已写过，summary 用 State.StatusCode
		case "err":
			s.Error = errorBrief(f.Value)
		}
	}
	if s.Detail || s.Sampled {
		emitStage(c, s, StageRelayFinished, now, fields)
	}
	emitSummaryIfNeeded(c, s)
}

// applyStage 将事件时间写入对应字段，并维护 retry / 错误等附加状态。
// 返回 true 表示该次调用实际产生了效果（首次写入 / retry 切换），
// false 表示是 first_chunk / first_write 这类"只取首次"的阶段被重复触发，应忽略。
func applyStage(s *State, stage Stage, now time.Time, fields []Field) bool {
	switch stage {
	case StageRequestReceived:
		if s.RequestReceived.IsZero() {
			s.RequestReceived = now
			return true
		}
		return false
	case StageChannelSelected:
		if !s.channelSelectedMarked {
			s.ChannelSelected = now
			s.channelSelectedMarked = true
			applyChannelFields(s, fields)
			return true
		}
		// 第二次及以后视为 retry
		attempt := RetryAttempt{SelectedAt: now}
		applyChannelFieldsToAttempt(&attempt, fields)
		s.RetryAttempts = append(s.RetryAttempts, attempt)
		s.RetryCount = len(s.RetryAttempts)
		applyChannelFields(s, fields)
		s.ChannelSelected = now
		return true
	case StageUpstreamRequestStart:
		s.UpstreamRequestStart = now
		if n := len(s.RetryAttempts); n > 0 {
			s.RetryAttempts[n-1].UpstreamRequestStart = now
		}
		return true
	case StageUpstreamResponseHeader:
		s.UpstreamResponseHeader = now
		applyStatusCode(s, fields)
		if n := len(s.RetryAttempts); n > 0 {
			s.RetryAttempts[n-1].UpstreamResponseHeader = now
			s.RetryAttempts[n-1].StatusCode = s.StatusCode
		}
		return true
	case StageUpstreamFirstChunk:
		if s.UpstreamFirstChunk.IsZero() {
			s.UpstreamFirstChunk = now
			applyChunkBytes(s, fields)
			return true
		}
		return false
	case StageClientFirstWrite:
		if s.ClientFirstWrite.IsZero() {
			s.ClientFirstWrite = now
			return true
		}
		return false
	case StageRelayFinished:
		s.RelayFinished = now
		return true
	}
	return false
}

func applyChannelFields(s *State, fields []Field) {
	for _, f := range fields {
		switch f.Key {
		case "channel_id":
			if v, err := atoiSafe(f.Value); err == nil {
				s.ChannelID = v
			}
		case "channel_type":
			if v, err := atoiSafe(f.Value); err == nil {
				s.ChannelType = v
			}
		case "origin_model":
			s.OriginModel = f.Value
		case "actual_model":
			s.ActualModel = f.Value
		case "stream":
			s.Stream = f.Value == "true"
		}
	}
}

func applyChannelFieldsToAttempt(a *RetryAttempt, fields []Field) {
	for _, f := range fields {
		switch f.Key {
		case "channel_id":
			if v, err := atoiSafe(f.Value); err == nil {
				a.ChannelID = v
			}
		case "channel_type":
			if v, err := atoiSafe(f.Value); err == nil {
				a.ChannelType = v
			}
		}
	}
}

func applyStatusCode(s *State, fields []Field) {
	for _, f := range fields {
		if f.Key == "status_code" {
			if v, err := atoiSafe(f.Value); err == nil {
				s.StatusCode = v
			}
		}
	}
}

func applyChunkBytes(s *State, fields []Field) {
	for _, f := range fields {
		if f.Key == "chunk_bytes" {
			if v, err := atoiSafe(f.Value); err == nil {
				s.FirstChunkBytes = v
			}
		}
	}
}

func atoiSafe(v string) (int, error) {
	var n int
	_, err := fmt.Sscanf(v, "%d", &n)
	return n, err
}

// shouldSample 实现万分比采样。0 不采样，10000 全采样。
func shouldSample(rate int) bool {
	if rate <= 0 {
		return false
	}
	if rate >= 10000 {
		return true
	}
	return rand.Intn(10000) < rate
}

// emitStage 输出一行阶段日志。仅在 Detail/Sampled 时被调用。
func emitStage(c *gin.Context, s *State, stage Stage, t time.Time, fields []Field) {
	pairs := []Field{
		{Key: "stage", Value: string(stage)},
		{Key: "request_id", Value: s.RequestID},
		{Key: "elapsed_ms", Value: itoa(s.elapsedMs(t))},
	}
	if s.UserID != 0 {
		pairs = append(pairs, F("user_id", s.UserID))
	}
	if s.ChannelID != 0 {
		pairs = append(pairs, F("channel_id", s.ChannelID))
	}
	if s.Stream {
		pairs = append(pairs, Field{Key: "stream", Value: "true"})
	}
	for _, f := range fields {
		if f.Key == "" {
			continue
		}
		// err 字段做摘要处理
		if f.Key == "err" {
			pairs = append(pairs, Field{Key: "err", Value: errorBrief(f.Value)})
			continue
		}
		pairs = append(pairs, f)
	}
	logger.Infof(getCtx(c), "relay timing %s", formatPairs(pairs))
}

func itoa(v int64) string {
	if v < 0 {
		return ""
	}
	return fmt.Sprintf("%d", v)
}

func getCtx(c *gin.Context) context.Context {
	if c == nil || c.Request == nil {
		return context.Background()
	}
	return c.Request.Context()
}

// 用于 summary 的辅助：只在 stage 已发生时写入键值。
func appendIfPositive(pairs []Field, key string, ms int64) []Field {
	if ms < 0 {
		return pairs
	}
	return append(pairs, Field{Key: key, Value: fmt.Sprintf("%d", ms)})
}

// 仅在该字符串非空时附加。
func appendIfNonEmpty(pairs []Field, key, value string) []Field {
	if value == "" {
		return pairs
	}
	return append(pairs, Field{Key: key, Value: value})
}
