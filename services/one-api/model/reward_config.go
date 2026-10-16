package model

import (
	"strconv"
	"strings"

	"github.com/songquanpeng/one-api/common/config"
)

// 达人兑换码奖励功能的全局配置（键值存 option 表，内存镜像走 config.OptionMap）。
//
// 整个兑换码功能共用一套配置：一个有效人群分群 + 一套奖励规则，不为每个达人单独配。
// 复用 option 表 + config.OptionMap，无需新建配置表；UpdateOption 会自动持久化并经
// updateOptionMap 的默认分支同步内存镜像。
const (
	// OptionRewardValidCrowdId 有效人群分群 ID（字符串数字）；空/"0" 表示不过滤（全部兑换人都算有效）。
	OptionRewardValidCrowdId = "RewardValidCrowdId"
	// OptionRewardRuleJSON 奖励规则结构化 JSON（见 reward_rule.go 的 RewardRule）；空表示无规则（当期奖励恒 0）。
	OptionRewardRuleJSON = "RewardRuleJSON"
)

// readOption 从内存镜像读取一个 option 值（带读锁），不存在返回空串。
func readOption(key string) string {
	config.OptionMapRWMutex.RLock()
	defer config.OptionMapRWMutex.RUnlock()
	return config.OptionMap[key]
}

// GetRewardValidCrowdId 读取有效人群分群 ID；未配置或非法返回 0（表示不过滤）。
func GetRewardValidCrowdId() int {
	v := strings.TrimSpace(readOption(OptionRewardValidCrowdId))
	if v == "" {
		return 0
	}
	id, err := strconv.Atoi(v)
	if err != nil || id < 0 {
		return 0
	}
	return id
}

// SetRewardValidCrowdId 写入有效人群分群 ID（0 表示不过滤，持久化为空串）。
func SetRewardValidCrowdId(crowdId int) error {
	val := ""
	if crowdId > 0 {
		val = strconv.Itoa(crowdId)
	}
	return UpdateOption(OptionRewardValidCrowdId, val)
}

// GetRewardRuleJSON 读取奖励规则 JSON 原文；未配置返回空串。
func GetRewardRuleJSON() string {
	return readOption(OptionRewardRuleJSON)
}

// SetRewardRuleJSON 写入奖励规则 JSON 原文。
func SetRewardRuleJSON(ruleJSON string) error {
	return UpdateOption(OptionRewardRuleJSON, ruleJSON)
}
