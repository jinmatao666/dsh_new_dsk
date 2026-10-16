package billing

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/timing"
)

// FillLogTiming 把 timing.State 的关键字段写入 *model.Log。
// state 为 nil 时直接 no-op，对老路径（没启用 timing）无副作用。
//
// 放在 relay/billing 包里的原因：
//   - billing 已经依赖 model 包；
//   - timing 包不依赖 billing/model/controller，因此 billing 引入 timing 没有循环依赖；
//   - controller 包已经导入 billing，复用方便。
func FillLogTiming(log *model.Log, state *timing.State) {
	if log == nil || state == nil {
		return
	}
	log.SelectMs = elapsedMs(state.RequestReceived, state.ChannelSelected)
	log.UpstreamRequestStartMs = elapsedMs(state.RequestReceived, state.UpstreamRequestStart)
	log.UpstreamHeaderMs = elapsedMs(state.RequestReceived, state.UpstreamResponseHeader)
	log.FirstChunkMs = elapsedMs(state.RequestReceived, state.UpstreamFirstChunk)
	log.FirstWriteMs = elapsedMs(state.RequestReceived, state.ClientFirstWrite)
	log.UpstreamWaitMs = elapsedMs(state.UpstreamRequestStart, state.UpstreamFirstChunk)
	log.WriteGapMs = elapsedMs(state.UpstreamFirstChunk, state.ClientFirstWrite)
	log.TimingStatus = state.Status
	log.TimingStatusCode = state.StatusCode
	log.TimingError = state.Error
	log.SlowReason = computeSlowReason(state)
	log.RetryCount = state.RetryCount
	if n := len(state.RetryAttempts); n > 0 {
		log.LastRetryStatus = state.RetryAttempts[n-1].StatusCode
	}
}

// FillLogTimingFromContext 从 context.Context 取 *timing.State 并填入 log。
// 适用于 postConsumeQuota 这类没有 *gin.Context 的协程路径。
func FillLogTimingFromContext(ctx context.Context, log *model.Log) {
	FillLogTiming(log, timing.GetFromContext(ctx))
}

// FillLogTimingFromGin 从 *gin.Context 取 *timing.State 并填入 log。
// 适用于 image 等仍持有 gin.Context 的路径。
func FillLogTimingFromGin(c *gin.Context, log *model.Log) {
	FillLogTiming(log, timing.Get(c))
}

// elapsedMs 返回从 start 到 end 的毫秒数；任何一端为零值则返回 0
// （约定 0 = 该阶段未发生，与 model.Log 字段 default:0 语义一致）。
func elapsedMs(start, end time.Time) int {
	if start.IsZero() || end.IsZero() {
		return 0
	}
	d := end.Sub(start).Milliseconds()
	if d < 0 {
		return 0
	}
	return int(d)
}

// computeSlowReason 复用 timing 包既有的慢请求判定阈值。
// first_chunk 优先于 total，与 timing/summary 的判定顺序保持一致。
func computeSlowReason(s *timing.State) string {
	totalMs := elapsedMs(s.RequestReceived, s.RelayFinished)
	firstChunkMs := elapsedMs(s.RequestReceived, s.UpstreamFirstChunk)
	if firstChunkMs > 0 && config.RelayTimingSlowFirstChunkMs > 0 &&
		firstChunkMs >= config.RelayTimingSlowFirstChunkMs {
		return "first_chunk"
	}
	if totalMs > 0 && config.RelayTimingSlowTotalMs > 0 &&
		totalMs >= config.RelayTimingSlowTotalMs {
		return "total"
	}
	return ""
}
