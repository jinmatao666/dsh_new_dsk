package price

import (
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"strconv"

	"github.com/songquanpeng/one-api/common/config"
)

const OptionKey = "ModelCreditPricing"

type Rates struct {
	Display    *float64 `json:"display,omitempty"`
	Input      float64  `json:"input"`
	Output     float64  `json:"output"`
	CacheRead  *float64 `json:"cache_read,omitempty"`
	CacheWrite *float64 `json:"cache_write,omitempty"`
}

// DisplayMultiplier is presentation metadata only and is never used in settlement.
func DisplayMultiplier(model string, input, output float64) (*float64, error) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap[OptionKey]
	config.OptionMapRWMutex.RUnlock()
	if raw != "" {
		var models map[string]Rates
		if err := json.Unmarshal([]byte(raw), &models); err != nil {
			return nil, err
		}
		if rates, exists := models[model]; exists {
			input, output = rates.Input, rates.Output
			if rates.Display != nil {
				if !valid(*rates.Display) {
					return nil, errors.New("桌面端显示倍率无效")
				}
				value := *rates.Display
				return &value, nil
			}
		}
	}
	if !valid(input) || !valid(output) {
		return nil, errors.New("模型倍率无效")
	}
	average := new(big.Rat).Add(rat(input), rat(output))
	value, _ := average.Quo(average, big.NewRat(2, 1)).Float64()
	return &value, nil
}

// Snapshot 在请求开始时固定价格，日志保留同一份价格用于历史核对。
type Snapshot struct {
	Version      int     `json:"version"`
	Source       string  `json:"source"`
	Model        string  `json:"model"`
	Base         float64 `json:"base"`
	Input        float64 `json:"input"`
	Output       float64 `json:"output"`
	CacheRead    float64 `json:"cache_read"`
	CacheWrite   float64 `json:"cache_write"`
	Group        float64 `json:"group"`
	QuotaPerUnit float64 `json:"quota_per_unit"`
}

type Receipt struct {
	Snapshot
	InputTokens      int    `json:"input_tokens"`
	OutputTokens     int    `json:"output_tokens"`
	CacheReadTokens  int    `json:"cache_read_tokens"`
	CacheWriteTokens int    `json:"cache_write_tokens"`
	Quota            int64  `json:"quota"`
	SessionID        string `json:"session_id,omitempty"`
	Status           string `json:"status"`
}

func valid(v float64) bool { return v >= 0 && !math.IsNaN(v) && !math.IsInf(v, 0) && v <= 1000000 }

func Resolve(model string, legacyInput, legacyCompletion, group float64) (*Snapshot, error) {
	config.OptionMapRWMutex.RLock()
	raw, deployment, unit := config.OptionMap[OptionKey], config.OptionMap["SystemDeploymentSettings"], config.QuotaPerUnit
	config.OptionMapRWMutex.RUnlock()
	if unit <= 0 || math.IsInf(unit, 0) || math.IsNaN(unit) || !valid(group) || !valid(legacyInput) || !valid(legacyInput*legacyCompletion) {
		return nil, errors.New("积分换算或分组倍率无效")
	}
	s := &Snapshot{Version: 2, Source: "legacy", Model: model, Base: 1000 / unit,
		Input: legacyInput, Output: legacyInput * legacyCompletion, CacheRead: legacyInput,
		CacheWrite: legacyInput, Group: group, QuotaPerUnit: unit}
	var settings struct {
		Edition string   `json:"edition"`
		Base    *float64 `json:"creditPricingBase"`
	}
	if deployment != "" {
		if err := json.Unmarshal([]byte(deployment), &settings); err != nil {
			return nil, err
		}
	}
	if raw == "" || settings.Edition == "government" {
		return s, nil
	}
	var models map[string]Rates
	if err := json.Unmarshal([]byte(raw), &models); err != nil {
		return nil, err
	}
	rates, exists := models[model]
	if !exists {
		return s, nil
	}
	s.Source, s.Base = "configured", 1
	if settings.Base != nil {
		s.Base = *settings.Base
	}
	s.Input, s.Output, s.CacheRead, s.CacheWrite = rates.Input, rates.Output, rates.Input, rates.Input
	if s.Base <= 0 || !valid(s.Base) || !valid(s.Input) || !valid(s.Output) || !valid(s.CacheRead) || !valid(s.CacheWrite) {
		return nil, errors.New("模型积分价格无效")
	}
	return s, nil
}

// 使用十进制有理数，避免 0.15 等价格因浮点误差被额外向上取整一份内部额度。
func rat(v float64) *big.Rat {
	r, _ := new(big.Rat).SetString(strconv.FormatFloat(v, 'f', -1, 64))
	return r
}

func (s *Snapshot) Calculate(prompt, output, read, write int) (Receipt, error) {
	if s.Version >= 2 {
		read, write = 0, 0
	}

	r := Receipt{Snapshot: *s, OutputTokens: output, CacheReadTokens: read, CacheWriteTokens: write, Status: "settled"}
	if prompt < 0 || output < 0 || read < 0 || write < 0 || read > prompt || write > prompt-read {
		return r, errors.New("模型缓存用量超出输入用量")
	}
	r.InputTokens = prompt - read - write
	total := new(big.Rat)
	for _, part := range []struct {
		tokens int
		rate   float64
	}{{r.InputTokens, s.Input}, {output, s.Output}, {read, s.CacheRead}, {write, s.CacheWrite}} {
		total.Add(total, new(big.Rat).Mul(new(big.Rat).SetInt64(int64(part.tokens)), rat(part.rate)))
	}
	total.Mul(total, rat(s.Base)).Mul(total, rat(s.Group)).Mul(total, rat(s.QuotaPerUnit)).Quo(total, big.NewRat(1000, 1))
	q, rem := new(big.Int), new(big.Int)
	q.QuoRem(total.Num(), total.Denom(), rem)
	if rem.Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	if !q.IsInt64() {
		return r, errors.New("积分消耗超出支持范围")
	}
	r.Quota = q.Int64()
	return r, nil
}

// 预扣按输入各类价格最大值计算，不在用量未知时假定缓存折扣。
func (s *Snapshot) Reserve(prompt, output int) (int64, error) {
	copy := *s
	if s.Version < 2 {
		copy.Input = math.Max(s.Input, math.Max(s.CacheRead, s.CacheWrite))
	}
	r, err := copy.Calculate(prompt, output, 0, 0)
	return r.Quota, err
}
