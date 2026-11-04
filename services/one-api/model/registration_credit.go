package model

import (
	"encoding/json"
	"errors"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"math"
	"strconv"
)

// RegistrationCreditRule returns whether the operational edition explicitly owns registration rewards.
func RegistrationCreditRule() (bool, int64, error) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	var s struct {
		Edition string `json:"edition"`
		Rewards struct {
			Registration *struct {
				Enabled bool  `json:"enabled"`
				Amount  int64 `json:"amount"`
			} `json:"registration"`
		} `json:"creditRewards"`
	}
	if raw == "" {
		return false, 0, nil
	}
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return false, 0, err
	}
	if s.Edition != "operations" || s.Rewards.Registration == nil {
		return false, 0, nil
	}
	r := s.Rewards.Registration
	if !r.Enabled {
		return true, 0, nil
	}
	unit := config.QuotaPerUnit
	if r.Amount < 1 || r.Amount > 1000000 || unit <= 0 || math.IsNaN(unit) || math.IsInf(unit, 0) || float64(r.Amount)*unit >= float64(math.MaxInt64) {
		return true, 0, errors.New("注册积分配置无效")
	}
	amount := int64(math.Round(float64(r.Amount) * unit))
	if amount <= 0 {
		return true, 0, errors.New("注册积分配置无效")
	}
	return true, amount, nil
}
func grantRegistrationCreditTx(tx *gorm.DB, user *User, amount int64) error {
	if amount == 0 || user.AccountType == AccountTypeEnterprise {
		return nil
	}
	return AddUserTimedQuotaTx(tx, user.Id, amount, "register", strconv.Itoa(user.Id), nil)
}
