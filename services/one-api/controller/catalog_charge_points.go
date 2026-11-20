package controller

import (
	"strings"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
)

type catalogChargePoint struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Credits float64 `json:"credits"`
}

// Catalog prices expose display metadata only; billing still resolves the rule at execution.
func catalogChargePoints(kind string, legacy map[string]int64) (map[string][]catalogChargePoint, error) {
	result := make(map[string][]catalogChargePoint, len(legacy))
	ids := make([]string, 0, len(legacy))
	for id := range legacy {
		ids = append(ids, id)
		result[id] = []catalogChargePoint{}
	}
	if len(ids) == 0 {
		return result, nil
	}
	var rules []model.BillingRule
	if model.DB.Migrator().HasTable(&model.BillingRule{}) {
		if err := model.DB.Where("kind = ? AND item_id IN ?", kind, ids).Order("updated_at DESC, id ASC").Find(&rules).Error; err != nil {
			return nil, err
		}
	}
	defaults := make(map[string]bool)
	for _, rule := range rules {
		if rule.Action == "default" {
			defaults[rule.ItemID] = true
		}
		if rule.IsDeleted || !rule.Enabled || rule.UnitQuota <= 0 || config.QuotaPerUnit <= 0 {
			continue
		}
		name := strings.TrimSpace(rule.Name)
		if name == "" {
			name = rule.Action
		}
		result[rule.ItemID] = append(result[rule.ItemID], catalogChargePoint{rule.ID, name, float64(rule.UnitQuota) / config.QuotaPerUnit})
	}
	for id, credits := range legacy {
		if !defaults[id] && credits > 0 {
			name := "技能调用"
			if kind == "expert" {
				name = "专家调用"
			}
			result[id] = append(result[id], catalogChargePoint{"default", name, float64(credits)})
		}
	}
	return result, nil
}
