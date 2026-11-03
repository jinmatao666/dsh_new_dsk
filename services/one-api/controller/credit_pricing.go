package controller

import (
	"encoding/json"
	"fmt"
	"math"
)

func validCreditPriceNumber(value float64, allowZero bool) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value <= 1000000 && (value > 0 || allowZero && value == 0)
}

// 独立价格用于运营版实际结算；未配置的模型沿用原有倍率。
func validateModelCreditPricing(raw string) error {
	var models map[string]struct {
		Display    *float64 `json:"display"`
		Input      *float64 `json:"input"`
		Output     *float64 `json:"output"`
		CacheRead  *float64 `json:"cache_read"`
		CacheWrite *float64 `json:"cache_write"`
	}
	if err := json.Unmarshal([]byte(raw), &models); err != nil || models == nil {
		return fmt.Errorf("模型积分配置必须为对象")
	}
	for name, prices := range models {
		if prices.Display != nil && !validCreditPriceNumber(*prices.Display, true) {
			return fmt.Errorf("桌面端显示倍率必须为 0 至 1,000,000 之间的数值")
		}
		if (prices.CacheRead != nil && !validCreditPriceNumber(*prices.CacheRead, true)) || (prices.CacheWrite != nil && !validCreditPriceNumber(*prices.CacheWrite, true)) {
			return fmt.Errorf("缓存倍率必须为 0 至 1,000,000 之间的数值")
		}
		if name == "" || prices.Input == nil || prices.Output == nil ||
			!validCreditPriceNumber(*prices.Input, true) || !validCreditPriceNumber(*prices.Output, true) {
			return fmt.Errorf("模型输入、输出倍率必须为 0 至 1,000,000 之间的数值")
		}
	}
	return nil
}

func validateCreditPricingBase(raw string) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return err
	}
	if value, exists := fields["creditPricingBase"]; exists {
		var base *float64
		if err := json.Unmarshal(value, &base); err != nil || base == nil || !validCreditPriceNumber(*base, false) {
			return fmt.Errorf("积分计费基准必须大于 0，且不能超过 1,000,000")
		}
	}
	return nil
}
