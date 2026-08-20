package timing

import (
	"time"
)

// Stage 表示 relay 链路上的一个观测阶段。
type Stage string

const (
	StageRequestReceived        Stage = "request_received"
	StageChannelSelected        Stage = "channel_selected"
	StageUpstreamRequestStart   Stage = "upstream_request_start"
	StageUpstreamResponseHeader Stage = "upstream_response_header"
	StageUpstreamFirstChunk     Stage = "upstream_first_chunk"
	StageClientFirstWrite       Stage = "client_first_write"
	StageRelayFinished          Stage = "relay_finished"
)

// ContextKey 是 *State 在 gin.Context 中的存取键。
const ContextKey = "relay_timing"

// State 持有单次 relay 请求的全部观测数据。
//
// 使用约束：
//   - 仅在主请求 goroutine 上读写。
//   - retry 场景下沿用同一个实例，将历史信息追加到 RetryAttempts，
//     ChannelSelected/UpstreamRequestStart/UpstreamResponseHeader 字段会被覆盖为最新一次。
type State struct {
	Enabled bool
	Detail  bool
	Sampled bool

	RequestID   string
	UserID      int
	ChannelID   int
	ChannelType int
	OriginModel string
	ActualModel string
	Stream      bool

	RequestReceived        time.Time
	ChannelSelected        time.Time
	UpstreamRequestStart   time.Time
	UpstreamResponseHeader time.Time
	UpstreamFirstChunk     time.Time
	ClientFirstWrite       time.Time
	RelayFinished          time.Time

	RetryCount    int
	RetryAttempts []RetryAttempt

	Status          string
	StatusCode      int
	Error           string
	FirstChunkBytes int

	// 内部标志，避免重复标记/重复输出
	channelSelectedMarked bool
	finished              bool
}

type RetryAttempt struct {
	ChannelID              int
	ChannelType            int
	SelectedAt             time.Time
	UpstreamRequestStart   time.Time
	UpstreamResponseHeader time.Time
	StatusCode             int
	Error                  string
}

// elapsedMs 返回从 RequestReceived 到 t 的毫秒数；t 为零值时返回 -1。
func (s *State) elapsedMs(t time.Time) int64 {
	if s == nil || t.IsZero() || s.RequestReceived.IsZero() {
		return -1
	}
	return t.Sub(s.RequestReceived).Milliseconds()
}
