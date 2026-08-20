package billing_test

import (
	"testing"
	"time"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/billing"
	"github.com/songquanpeng/one-api/relay/timing"
)

// resetTimingThresholds 把 RelayTiming 慢请求阈值恢复到默认值，
// 避免不同测试用例之间互相干扰。
func resetTimingThresholds() {
	config.RelayTimingSlowFirstChunkMs = 3000
	config.RelayTimingSlowTotalMs = 30000
}

// newHappyState 构造一个所有阶段都按典型顺序推进的 *timing.State，
// 时间差易于断言：select=10ms, upstream_request_start=20ms,
// upstream_header=120ms, first_chunk=150ms, first_write=160ms,
// relay_finished=200ms。
func newHappyState() *timing.State {
	base := time.Now()
	return &timing.State{
		Enabled:                true,
		RequestReceived:        base,
		ChannelSelected:        base.Add(10 * time.Millisecond),
		UpstreamRequestStart:   base.Add(20 * time.Millisecond),
		UpstreamResponseHeader: base.Add(120 * time.Millisecond),
		UpstreamFirstChunk:     base.Add(150 * time.Millisecond),
		ClientFirstWrite:       base.Add(160 * time.Millisecond),
		RelayFinished:          base.Add(200 * time.Millisecond),
		Status:                 "ok",
	}
}

func TestFillLogTiming_NilState(t *testing.T) {
	resetTimingThresholds()

	log := &model.Log{}
	billing.FillLogTiming(log, nil)

	if log.SelectMs != 0 || log.FirstChunkMs != 0 || log.UpstreamWaitMs != 0 ||
		log.WriteGapMs != 0 || log.SlowReason != "" || log.TimingStatus != "" {
		t.Fatalf("nil state should leave log untouched, got %+v", log)
	}
}

func TestFillLogTiming_HappyPath(t *testing.T) {
	resetTimingThresholds()

	state := newHappyState()
	log := &model.Log{}
	billing.FillLogTiming(log, state)

	if log.SelectMs != 10 {
		t.Fatalf("SelectMs: want 10, got %d", log.SelectMs)
	}
	if log.UpstreamRequestStartMs != 20 {
		t.Fatalf("UpstreamRequestStartMs: want 20, got %d", log.UpstreamRequestStartMs)
	}
	if log.UpstreamHeaderMs != 120 {
		t.Fatalf("UpstreamHeaderMs: want 120, got %d", log.UpstreamHeaderMs)
	}
	if log.FirstChunkMs != 150 {
		t.Fatalf("FirstChunkMs: want 150, got %d", log.FirstChunkMs)
	}
	if log.FirstWriteMs != 160 {
		t.Fatalf("FirstWriteMs: want 160, got %d", log.FirstWriteMs)
	}
	// upstream_wait = first_chunk - upstream_request_start = 150 - 20 = 130
	if log.UpstreamWaitMs != 130 {
		t.Fatalf("UpstreamWaitMs: want 130, got %d", log.UpstreamWaitMs)
	}
	// write_gap = first_write - first_chunk = 160 - 150 = 10
	if log.WriteGapMs != 10 {
		t.Fatalf("WriteGapMs: want 10, got %d", log.WriteGapMs)
	}
	if log.TimingStatus != "ok" {
		t.Fatalf("TimingStatus: want ok, got %q", log.TimingStatus)
	}
	// 阈值默认 3000/30000，本用例不应被判定为慢
	if log.SlowReason != "" {
		t.Fatalf("SlowReason: want empty, got %q", log.SlowReason)
	}
}

func TestFillLogTiming_PartialState(t *testing.T) {
	resetTimingThresholds()

	base := time.Now()
	state := &timing.State{
		Enabled:              true,
		RequestReceived:      base,
		UpstreamRequestStart: base.Add(20 * time.Millisecond),
	}
	log := &model.Log{}
	billing.FillLogTiming(log, state)

	if log.UpstreamRequestStartMs != 20 {
		t.Fatalf("UpstreamRequestStartMs: want 20, got %d", log.UpstreamRequestStartMs)
	}
	// 未发生的阶段应当为 0（model.Log 字段约定）。
	if log.SelectMs != 0 {
		t.Fatalf("SelectMs (no ChannelSelected): want 0, got %d", log.SelectMs)
	}
	if log.FirstChunkMs != 0 {
		t.Fatalf("FirstChunkMs: want 0, got %d", log.FirstChunkMs)
	}
	if log.FirstWriteMs != 0 {
		t.Fatalf("FirstWriteMs: want 0, got %d", log.FirstWriteMs)
	}
	if log.UpstreamWaitMs != 0 {
		t.Fatalf("UpstreamWaitMs (no first chunk): want 0, got %d", log.UpstreamWaitMs)
	}
	if log.WriteGapMs != 0 {
		t.Fatalf("WriteGapMs: want 0, got %d", log.WriteGapMs)
	}
	if log.SlowReason != "" {
		t.Fatalf("SlowReason: want empty (no first chunk, no finish), got %q", log.SlowReason)
	}
}

func TestFillLogTiming_SlowReason_FirstChunk(t *testing.T) {
	resetTimingThresholds()
	// 把 first_chunk 阈值压到 100ms，让 happy state（first_chunk=150ms）触发
	config.RelayTimingSlowFirstChunkMs = 100
	defer resetTimingThresholds()

	state := newHappyState()
	log := &model.Log{}
	billing.FillLogTiming(log, state)

	if log.SlowReason != "first_chunk" {
		t.Fatalf("SlowReason: want first_chunk, got %q", log.SlowReason)
	}
}

func TestFillLogTiming_SlowReason_Total(t *testing.T) {
	resetTimingThresholds()
	// first_chunk 阈值不触发；total 阈值压到 150ms，happy state total=200ms 应触发
	config.RelayTimingSlowFirstChunkMs = 3000
	config.RelayTimingSlowTotalMs = 150
	defer resetTimingThresholds()

	state := newHappyState()
	log := &model.Log{}
	billing.FillLogTiming(log, state)

	if log.SlowReason != "total" {
		t.Fatalf("SlowReason: want total, got %q", log.SlowReason)
	}
}

func TestFillLogTiming_RetryFields(t *testing.T) {
	resetTimingThresholds()

	state := newHappyState()
	state.RetryCount = 2
	state.RetryAttempts = []timing.RetryAttempt{
		{ChannelID: 1, StatusCode: 500},
		{ChannelID: 2, StatusCode: 502},
	}
	log := &model.Log{}
	billing.FillLogTiming(log, state)

	if log.RetryCount != 2 {
		t.Fatalf("RetryCount: want 2, got %d", log.RetryCount)
	}
	if log.LastRetryStatus != 502 {
		t.Fatalf("LastRetryStatus: want 502 (last attempt), got %d", log.LastRetryStatus)
	}
}

func TestFillLogTiming_ErrorFields(t *testing.T) {
	resetTimingThresholds()

	state := newHappyState()
	state.Status = "error"
	state.StatusCode = 502
	state.Error = "do_request_failed"
	log := &model.Log{}
	billing.FillLogTiming(log, state)

	if log.TimingStatus != "error" {
		t.Fatalf("TimingStatus: want error, got %q", log.TimingStatus)
	}
	if log.TimingStatusCode != 502 {
		t.Fatalf("TimingStatusCode: want 502, got %d", log.TimingStatusCode)
	}
	if log.TimingError != "do_request_failed" {
		t.Fatalf("TimingError: want do_request_failed, got %q", log.TimingError)
	}
}
