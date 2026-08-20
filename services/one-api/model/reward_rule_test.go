package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEvaluateReward(t *testing.T) {
	tieredRule := &RewardRule{
		Version:  1,
		Currency: "CNY",
		Mode:     RewardModeTiered,
		Tiers: []RewardTier{
			{MinCount: 1, MaxCount: 9, UnitPrice: 5, FlatBonus: 0},
			{MinCount: 10, MaxCount: 99, UnitPrice: 8, FlatBonus: 50},
			{MinCount: 100, MaxCount: 0, UnitPrice: 10, FlatBonus: 100}, // 无上限
		},
	}

	tests := []struct {
		name     string
		rule     *RewardRule
		in       RewardInput
		wantCent int64
	}{
		{
			name:     "per_unit 基础",
			rule:     &RewardRule{Mode: RewardModePerUnit, UnitPrice: 1.5},
			in:       RewardInput{ValidCount: 3},
			wantCent: 450, // 3 * 1.5 = 4.5 元 = 450 分
		},
		{
			name:     "per_unit 零人数",
			rule:     &RewardRule{Mode: RewardModePerUnit, UnitPrice: 1.5},
			in:       RewardInput{ValidCount: 0},
			wantCent: 0,
		},
		{
			name:     "tiered 命中第一档",
			rule:     tieredRule,
			in:       RewardInput{ValidCount: 5},
			wantCent: 2500, // 5 * 5 = 25 元
		},
		{
			name:     "tiered 第一档下边界",
			rule:     tieredRule,
			in:       RewardInput{ValidCount: 1},
			wantCent: 500, // 1 * 5
		},
		{
			name:     "tiered 第一档上边界",
			rule:     tieredRule,
			in:       RewardInput{ValidCount: 9},
			wantCent: 4500, // 9 * 5
		},
		{
			name:     "tiered 命中第二档含 flat_bonus",
			rule:     tieredRule,
			in:       RewardInput{ValidCount: 10},
			wantCent: 13000, // 10 * 8 + 50 = 130 元
		},
		{
			name:     "tiered 第二档上边界",
			rule:     tieredRule,
			in:       RewardInput{ValidCount: 99},
			wantCent: 84200, // 99 * 8 + 50 = 842 元
		},
		{
			name:     "tiered 无上限末档",
			rule:     tieredRule,
			in:       RewardInput{ValidCount: 1000},
			wantCent: 1010000, // 1000 * 10 + 100 = 10100 元
		},
		{
			name:     "tiered 低于最低档返回 0",
			rule:     tieredRule,
			in:       RewardInput{ValidCount: 0},
			wantCent: 0,
		},
		{
			name: "tiered_per_unit 与 tiered 同路径",
			rule: &RewardRule{
				Mode: RewardModeTieredPerUnit,
				Tiers: []RewardTier{
					{MinCount: 1, MaxCount: 0, UnitPrice: 2},
				},
			},
			in:       RewardInput{ValidCount: 7},
			wantCent: 1400, // 7 * 2
		},
		{
			name: "modifier 命中 channel",
			rule: &RewardRule{
				Mode:      RewardModePerUnit,
				UnitPrice: 10,
				Modifiers: []RewardModifier{
					{Field: RewardFieldChannel, Equals: "douyin", Multiplier: 1.5},
				},
			},
			in:       RewardInput{ValidCount: 2, Channel: "douyin"},
			wantCent: 3000, // 2*10=20, *1.5 = 30 元
		},
		{
			name: "modifier 未命中 channel",
			rule: &RewardRule{
				Mode:      RewardModePerUnit,
				UnitPrice: 10,
				Modifiers: []RewardModifier{
					{Field: RewardFieldChannel, Equals: "douyin", Multiplier: 1.5},
				},
			},
			in:       RewardInput{ValidCount: 2, Channel: "kuaishou"},
			wantCent: 2000, // 不打折
		},
		{
			name: "modifier 命中 influencer_name",
			rule: &RewardRule{
				Mode:      RewardModePerUnit,
				UnitPrice: 10,
				Modifiers: []RewardModifier{
					{Field: RewardFieldInfluencerName, Equals: "张三", Multiplier: 2},
				},
			},
			in:       RewardInput{ValidCount: 1, InfluencerName: "张三"},
			wantCent: 2000, // 1*10=10, *2 = 20 元
		},
		{
			name: "多个 modifier 依次相乘",
			rule: &RewardRule{
				Mode:      RewardModePerUnit,
				UnitPrice: 10,
				Modifiers: []RewardModifier{
					{Field: RewardFieldChannel, Equals: "douyin", Multiplier: 2},
					{Field: RewardFieldInfluencerName, Equals: "张三", Multiplier: 1.5},
				},
			},
			in:       RewardInput{ValidCount: 1, Channel: "douyin", InfluencerName: "张三"},
			wantCent: 3000, // 10 * 2 * 1.5 = 30 元
		},
		{
			name:     "nil 规则返回 0",
			rule:     nil,
			in:       RewardInput{ValidCount: 100},
			wantCent: 0,
		},
		{
			name:     "空 mode 返回 0",
			rule:     &RewardRule{Mode: ""},
			in:       RewardInput{ValidCount: 100},
			wantCent: 0,
		},
		{
			name:     "分舍入: 0.005 元 * 100 = 0.5 进位到 1 分",
			rule:     &RewardRule{Mode: RewardModePerUnit, UnitPrice: 0.005},
			in:       RewardInput{ValidCount: 1},
			wantCent: 1, // round(0.5) = 1
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EvaluateReward(tt.rule, tt.in)
			assert.NoError(t, err)
			assert.Equal(t, tt.wantCent, got)
		})
	}
}

func TestEvaluateReward_UnknownMode(t *testing.T) {
	_, err := EvaluateReward(&RewardRule{Mode: "bogus"}, RewardInput{ValidCount: 1})
	assert.Error(t, err)
}

func TestValidateRewardRule(t *testing.T) {
	tests := []struct {
		name    string
		rule    *RewardRule
		wantErr bool
	}{
		{
			name:    "合法 per_unit",
			rule:    &RewardRule{Mode: RewardModePerUnit, UnitPrice: 1.5},
			wantErr: false,
		},
		{
			name:    "per_unit 单价为负",
			rule:    &RewardRule{Mode: RewardModePerUnit, UnitPrice: -1},
			wantErr: true,
		},
		{
			name: "合法 tiered 连续区间",
			rule: &RewardRule{
				Mode: RewardModeTiered,
				Tiers: []RewardTier{
					{MinCount: 1, MaxCount: 9, UnitPrice: 5},
					{MinCount: 10, MaxCount: 99, UnitPrice: 8},
					{MinCount: 100, MaxCount: 0, UnitPrice: 10},
				},
			},
			wantErr: false,
		},
		{
			name:    "tiered 空档位",
			rule:    &RewardRule{Mode: RewardModeTiered, Tiers: nil},
			wantErr: true,
		},
		{
			name: "tiered 区间重叠",
			rule: &RewardRule{
				Mode: RewardModeTiered,
				Tiers: []RewardTier{
					{MinCount: 1, MaxCount: 10, UnitPrice: 5},
					{MinCount: 5, MaxCount: 20, UnitPrice: 8},
				},
			},
			wantErr: true,
		},
		{
			name: "tiered 区间空洞",
			rule: &RewardRule{
				Mode: RewardModeTiered,
				Tiers: []RewardTier{
					{MinCount: 1, MaxCount: 9, UnitPrice: 5},
					{MinCount: 20, MaxCount: 0, UnitPrice: 8},
				},
			},
			wantErr: true,
		},
		{
			name: "tiered 中间档无上限",
			rule: &RewardRule{
				Mode: RewardModeTiered,
				Tiers: []RewardTier{
					{MinCount: 1, MaxCount: 0, UnitPrice: 5},
					{MinCount: 10, MaxCount: 99, UnitPrice: 8},
				},
			},
			wantErr: true,
		},
		{
			name: "tiered 单价为负",
			rule: &RewardRule{
				Mode: RewardModeTiered,
				Tiers: []RewardTier{
					{MinCount: 1, MaxCount: 0, UnitPrice: -5},
				},
			},
			wantErr: true,
		},
		{
			name: "tiered 固定奖励为负",
			rule: &RewardRule{
				Mode: RewardModeTiered,
				Tiers: []RewardTier{
					{MinCount: 1, MaxCount: 0, UnitPrice: 5, FlatBonus: -1},
				},
			},
			wantErr: true,
		},
		{
			name: "tiered 上限小于下限",
			rule: &RewardRule{
				Mode: RewardModeTiered,
				Tiers: []RewardTier{
					{MinCount: 10, MaxCount: 5, UnitPrice: 5},
				},
			},
			wantErr: true,
		},
		{
			name:    "无效 mode",
			rule:    &RewardRule{Mode: "bogus"},
			wantErr: true,
		},
		{
			name:    "nil 规则",
			rule:    nil,
			wantErr: true,
		},
		{
			name: "modifier 字段无效",
			rule: &RewardRule{
				Mode:      RewardModePerUnit,
				UnitPrice: 1,
				Modifiers: []RewardModifier{{Field: "bogus", Equals: "x", Multiplier: 1}},
			},
			wantErr: true,
		},
		{
			name: "modifier 乘数为负",
			rule: &RewardRule{
				Mode:      RewardModePerUnit,
				UnitPrice: 1,
				Modifiers: []RewardModifier{{Field: RewardFieldChannel, Equals: "x", Multiplier: -1}},
			},
			wantErr: true,
		},
		{
			name: "合法 modifier",
			rule: &RewardRule{
				Mode:      RewardModePerUnit,
				UnitPrice: 1,
				Modifiers: []RewardModifier{{Field: RewardFieldChannel, Equals: "douyin", Multiplier: 1.5}},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRewardRule(tt.rule)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}
