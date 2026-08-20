package model

import (
	"fmt"
	"math"
	"sort"
)

// RewardRule 是达人现金佣金的结构化奖励规则。
// 由 AI 生成 JSON、人工审核，后端按固定算法求值，绝不执行任意代码/表达式。
type RewardRule struct {
	Version   int              `json:"version"`             // 结构版本，默认 1
	Currency  string           `json:"currency"`            // "CNY"
	Mode      string           `json:"mode"`                // "tiered" | "per_unit" | "tiered_per_unit"
	UnitPrice float64          `json:"unit_price,omitempty"` // 单价模式: 每有效人数 * UnitPrice
	Tiers     []RewardTier     `json:"tiers,omitempty"`     // 阶梯模式: 按有效人数落入区间
	Modifiers []RewardModifier `json:"modifiers,omitempty"` // 维度系数(可选): 命中则整体乘 multiplier
	Note      string           `json:"note"`                // AI 生成的人类可读说明, 仅展示
}

// RewardTier 是一个阶梯区间 [MinCount, MaxCount]（含端点）。
type RewardTier struct {
	MinCount  int     `json:"min_count"`  // 有效人数下限(含)
	MaxCount  int     `json:"max_count"`  // 上限(含); 0 = 无上限
	UnitPrice float64 `json:"unit_price"` // 落入本区间时每有效人单价
	FlatBonus float64 `json:"flat_bonus"` // 落入本区间额外固定奖励(可选)
}

// RewardModifier 是命中后整体奖励乘以 Multiplier 的维度系数。
type RewardModifier struct {
	Field      string  `json:"field"`      // "channel" | "influencer_name"
	Equals     string  `json:"equals"`     // 匹配值
	Multiplier float64 `json:"multiplier"` // 命中后整体奖励 * 此系数
}

// RewardInput 是求值所需的运行时输入。
type RewardInput struct {
	ValidCount     int    // 有效人数(核心)
	RedeemedCount  int    // 兑换总人数
	Channel        string // 渠道
	InfluencerName string // 达人名称
}

const (
	RewardModePerUnit       = "per_unit"
	RewardModeTiered        = "tiered"
	RewardModeTieredPerUnit = "tiered_per_unit"

	RewardFieldChannel        = "channel"
	RewardFieldInfluencerName = "influencer_name"
)

// EvaluateReward 返回给定输入对应的奖励金额，单位为「分」(int64)。
//
// 注意：开发计划中讨论的是「元」，但存储/传输单位统一为「分」。
// 计算时先按元算出 float，再 cents = round(yuan*100)，避免浮点误差。
//
// 规则缺失/mode 为空 → 返回 0 分且不报错（列表降级显示 0）。
func EvaluateReward(rule *RewardRule, in RewardInput) (amountCents int64, err error) {
	// 规则缺失或 mode 为空：降级返回 0，不报错。
	if rule == nil || rule.Mode == "" {
		return 0, nil
	}

	var amountYuan float64

	switch rule.Mode {
	case RewardModePerUnit:
		amountYuan = float64(in.ValidCount) * rule.UnitPrice

	case RewardModeTiered, RewardModeTieredPerUnit:
		// tiered_per_unit 与 tiered 走相同代码路径：tier 自带每人单价。
		tier := findTier(rule.Tiers, in.ValidCount)
		if tier == nil {
			// 未命中任何档（例如低于最低 min_count）→ 0。
			amountYuan = 0
		} else {
			amountYuan = float64(in.ValidCount)*tier.UnitPrice + tier.FlatBonus
		}

	default:
		return 0, fmt.Errorf("未知的奖励模式: %q", rule.Mode)
	}

	// 依次应用所有命中的维度系数。
	for _, m := range rule.Modifiers {
		if modifierMatches(m, in) {
			amountYuan *= m.Multiplier
		}
	}

	amountCents = int64(math.Round(amountYuan * 100))
	return amountCents, nil
}

// findTier 返回 count 落入的第一个区间 [MinCount, MaxCount]（含端点；MaxCount==0 表示无上限）。
// 未命中返回 nil。
func findTier(tiers []RewardTier, count int) *RewardTier {
	for i := range tiers {
		t := &tiers[i]
		if count < t.MinCount {
			continue
		}
		if t.MaxCount == 0 || count <= t.MaxCount {
			return t
		}
	}
	return nil
}

func modifierMatches(m RewardModifier, in RewardInput) bool {
	switch m.Field {
	case RewardFieldChannel:
		return in.Channel == m.Equals
	case RewardFieldInfluencerName:
		return in.InfluencerName == m.Equals
	default:
		return false
	}
}

// ValidateRewardRule 校验规则合法性，供保存接口与 AI 生成后端二次校验。
// 检查 mode 合法、tiers 区间不重叠不留空洞（排序后从最低 min_count 起连续）、
// 单价非负、系数非负。返回清晰的中文错误。
func ValidateRewardRule(rule *RewardRule) error {
	if rule == nil {
		return fmt.Errorf("奖励规则为空")
	}

	switch rule.Mode {
	case RewardModePerUnit:
		if rule.UnitPrice < 0 {
			return fmt.Errorf("单价模式的单价不能为负数")
		}

	case RewardModeTiered, RewardModeTieredPerUnit:
		if err := validateTiers(rule.Tiers); err != nil {
			return err
		}

	default:
		return fmt.Errorf("无效的奖励模式: %q（必须是 per_unit / tiered / tiered_per_unit 之一）", rule.Mode)
	}

	// 校验维度系数。
	for i, m := range rule.Modifiers {
		if m.Field != RewardFieldChannel && m.Field != RewardFieldInfluencerName {
			return fmt.Errorf("第 %d 个维度系数的字段无效: %q（必须是 channel 或 influencer_name）", i+1, m.Field)
		}
		if m.Multiplier < 0 {
			return fmt.Errorf("第 %d 个维度系数的乘数不能为负数", i+1)
		}
	}

	return nil
}

func validateTiers(tiers []RewardTier) error {
	if len(tiers) == 0 {
		return fmt.Errorf("阶梯模式必须至少包含一个档位")
	}

	// 逐档基础校验。
	for i, t := range tiers {
		if t.MinCount < 0 {
			return fmt.Errorf("第 %d 档的下限不能为负数", i+1)
		}
		if t.UnitPrice < 0 {
			return fmt.Errorf("第 %d 档的单价不能为负数", i+1)
		}
		if t.FlatBonus < 0 {
			return fmt.Errorf("第 %d 档的固定奖励不能为负数", i+1)
		}
		if t.MaxCount != 0 && t.MaxCount < t.MinCount {
			return fmt.Errorf("第 %d 档的上限(%d)不能小于下限(%d)", i+1, t.MaxCount, t.MinCount)
		}
	}

	// 按 MinCount 排序后检查连续、不重叠、不留空洞。
	sorted := make([]RewardTier, len(tiers))
	copy(sorted, tiers)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].MinCount < sorted[j].MinCount
	})

	for i := 0; i < len(sorted)-1; i++ {
		cur := sorted[i]
		next := sorted[i+1]
		// 除最后一档外，每一档都必须有上限。
		if cur.MaxCount == 0 {
			return fmt.Errorf("只有最后一档可以无上限，第 %d 档（下限 %d）缺少上限", i+1, cur.MinCount)
		}
		// 下一档的下限必须紧接当前档的上限 +1（既不重叠也不留空洞）。
		if next.MinCount != cur.MaxCount+1 {
			if next.MinCount <= cur.MaxCount {
				return fmt.Errorf("档位区间重叠：下限 %d 的档与上限 %d 的档冲突", next.MinCount, cur.MaxCount)
			}
			return fmt.Errorf("档位区间存在空洞：上限 %d 与下一档下限 %d 之间不连续", cur.MaxCount, next.MinCount)
		}
	}

	return nil
}
