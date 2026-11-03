package controller

import (
	"encoding/json"
	"fmt"

	"github.com/songquanpeng/one-api/common/config"
)

// Missing rules keep existing deployments unchanged. Explicit rules must be complete,
// including when disabled, so enabling a saved rule cannot expose invalid values.
func validateCreditRewards(raw string) error {
	var settings map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return err
	}
	value, exists := settings["creditRewards"]
	if !exists {
		return nil
	}
	var rules struct {
		Registration *struct {
			Enabled *bool `json:"enabled"`
			Amount  *int  `json:"amount"`
		} `json:"registration"`
		Login *struct {
			Enabled      *bool `json:"enabled"`
			Amount       *int  `json:"amount"`
			IntervalDays *int  `json:"intervalDays"`
		} `json:"login"`
	}
	if err := json.Unmarshal(value, &rules); err != nil || rules.Registration == nil || rules.Login == nil ||
		rules.Registration.Enabled == nil || rules.Login.Enabled == nil ||
		!validRewardAmount(rules.Registration.Amount) || !validRewardAmount(rules.Login.Amount) {
		return fmt.Errorf("积分赠送配置无效：需要独立开关，赠送积分须为 1 至 1,000,000 的整数")
	}
	if rules.Login.IntervalDays == nil || *rules.Login.IntervalDays < 1 || *rules.Login.IntervalDays > 3650 {
		return fmt.Errorf("登录发放周期必须为 1 至 3,650 天的整数")
	}
	return nil
}

func validRewardAmount(value *int) bool {
	return value != nil && *value >= 1 && *value <= 1000000
}

// Put changed reward rules before the generic settings snapshot so a long
// deployment configuration cannot truncate the financial rule change away.
func creditRewardAuditDetail(raw string) []byte {
	config.OptionMapRWMutex.RLock()
	previous := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	var before, after map[string]json.RawMessage
	_ = json.Unmarshal([]byte(previous), &before)
	_ = json.Unmarshal([]byte(raw), &after)
	if string(before["creditRewards"]) == string(after["creditRewards"]) {
		return nil
	}
	detail, _ := json.Marshal(struct {
		Setting  string                     `json:"setting"`
		Before   json.RawMessage            `json:"before"`
		After    json.RawMessage            `json:"after"`
		Settings map[string]json.RawMessage `json:"settings"`
	}{"积分赠送规则", before["creditRewards"], after["creditRewards"], after})
	return detail
}
