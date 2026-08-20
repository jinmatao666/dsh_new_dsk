package timing

import (
	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
)

// emitSummaryIfNeeded 在 relay 完成时，根据慢请求阈值 / 详细模式 / 采样判断是否输出 summary。
//
// 输出条件（满足任一）：
//   - 详细模式或命中采样
//   - first_chunk_ms 超过 RelayTimingSlowFirstChunkMs
//   - total_ms 超过 RelayTimingSlowTotalMs
//   - status 非 ok（含 error / client_canceled）
func emitSummaryIfNeeded(c *gin.Context, s *State) {
	totalMs := s.elapsedMs(s.RelayFinished)
	firstChunkMs := s.elapsedMs(s.UpstreamFirstChunk)

	slowFirstChunk := firstChunkMs >= 0 && config.RelayTimingSlowFirstChunkMs > 0 &&
		firstChunkMs >= int64(config.RelayTimingSlowFirstChunkMs)
	slowTotal := totalMs >= 0 && config.RelayTimingSlowTotalMs > 0 &&
		totalMs >= int64(config.RelayTimingSlowTotalMs)

	statusError := s.Status != "" && s.Status != "ok"

	if !s.Detail && !s.Sampled && !slowFirstChunk && !slowTotal && !statusError {
		return
	}

	pairs := buildSummaryPairs(s, totalMs, firstChunkMs, slowFirstChunk, slowTotal)
	logger.Infof(getCtx(c), "relay timing summary %s", formatPairs(pairs))
}

func buildSummaryPairs(s *State, totalMs, firstChunkMs int64, slowFirstChunk, slowTotal bool) []Field {
	pairs := []Field{
		{Key: "request_id", Value: s.RequestID},
	}
	if s.UserID != 0 {
		pairs = append(pairs, F("user_id", s.UserID))
	}
	if s.ChannelID != 0 {
		pairs = append(pairs, F("channel_id", s.ChannelID))
	}
	if s.ChannelType != 0 {
		pairs = append(pairs, F("channel_type", s.ChannelType))
	}
	pairs = appendIfNonEmpty(pairs, "model", coalesce(s.ActualModel, s.OriginModel))
	if s.OriginModel != "" && s.ActualModel != "" && s.OriginModel != s.ActualModel {
		pairs = append(pairs, Field{Key: "origin_model", Value: s.OriginModel})
	}
	pairs = append(pairs, Field{Key: "stream", Value: boolStr(s.Stream)})
	if s.Status != "" {
		pairs = append(pairs, Field{Key: "status", Value: s.Status})
	}
	if s.StatusCode != 0 {
		pairs = append(pairs, F("status_code", s.StatusCode))
	}

	pairs = appendIfPositive(pairs, "total_ms", totalMs)
	pairs = appendIfPositive(pairs, "select_ms", s.elapsedMs(s.ChannelSelected))
	pairs = appendIfPositive(pairs, "upstream_request_start_ms", s.elapsedMs(s.UpstreamRequestStart))
	pairs = appendIfPositive(pairs, "upstream_header_ms", s.elapsedMs(s.UpstreamResponseHeader))
	pairs = appendIfPositive(pairs, "first_chunk_ms", firstChunkMs)
	pairs = appendIfPositive(pairs, "first_write_ms", s.elapsedMs(s.ClientFirstWrite))

	// 派生：upstream_wait_ms = first_chunk - upstream_request_start
	if !s.UpstreamFirstChunk.IsZero() && !s.UpstreamRequestStart.IsZero() {
		ms := s.UpstreamFirstChunk.Sub(s.UpstreamRequestStart).Milliseconds()
		pairs = appendIfPositive(pairs, "upstream_wait_ms", ms)
	}
	// 派生：write_gap_ms = first_write - first_chunk
	if !s.ClientFirstWrite.IsZero() && !s.UpstreamFirstChunk.IsZero() {
		ms := s.ClientFirstWrite.Sub(s.UpstreamFirstChunk).Milliseconds()
		pairs = appendIfPositive(pairs, "write_gap_ms", ms)
	}

	if s.FirstChunkBytes > 0 {
		pairs = append(pairs, F("first_chunk_bytes", s.FirstChunkBytes))
	}
	if s.RetryCount > 0 {
		pairs = append(pairs, F("retry_count", s.RetryCount))
		if last := s.RetryAttempts[len(s.RetryAttempts)-1]; last.StatusCode != 0 {
			pairs = append(pairs, F("last_retry_status", last.StatusCode))
		}
	}

	switch {
	case slowFirstChunk:
		pairs = append(pairs, Field{Key: "slow_reason", Value: "first_chunk"})
	case slowTotal:
		pairs = append(pairs, Field{Key: "slow_reason", Value: "total"})
	}

	if s.Error != "" {
		pairs = append(pairs, Field{Key: "err", Value: errorBrief(s.Error)})
	}
	return pairs
}

func coalesce(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func boolStr(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
