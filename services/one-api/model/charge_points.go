package model

import (
	"errors"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"strings"
)

// Knowledge service billing uses one stable resource, independent of library IDs.
const BillingKindKnowledgeService = "knowledge_service"
const BillingKnowledgeServiceID = "default"

// BillingResourceName resolves the resource label without user content.
func BillingResourceName(tx *gorm.DB, kind, item string) (string, error) {
	tx = tx.Session(&gorm.Session{NewDB: true})
	switch kind {
	case BillingKindForum:
		if item == "default" {
			return "资规讲坛", nil
		}
		return "", errors.New("INVALID_REQUEST")
	case BillingKindKnowledgeService:
		if item == BillingKnowledgeServiceID {
			return "知识库服务", nil
		}
		return "", errors.New("INVALID_REQUEST")
	case "expert":
		var row ExpertWebProfile
		err := tx.Session(&gorm.Session{NewDB: true}).Where(map[string]interface{}{"key": item}).First(&row).Error
		return row.Name, err
	case "skill":
		var row Skill
		err := tx.Session(&gorm.Session{NewDB: true}).Where("name = ?", item).First(&row).Error
		if row.DisplayName != "" {
			return row.DisplayName, err
		}
		return row.Name, err
	case "knowledge":
		var row KnowledgeBase
		err := tx.Session(&gorm.Session{NewDB: true}).Where("id = ?", item).First(&row).Error
		return row.Name, err
	}
	return "", errors.New("INVALID_REQUEST")
}

// EnsureSkillChargePoint initializes the unique default action from its legacy price.
// The unique billing_action index arbitrates concurrent initialization.
func EnsureSkillChargePoint(tx *gorm.DB, name string) (BillingRule, error) {
	tx = tx.Session(&gorm.Session{NewDB: true})
	var rule BillingRule
	query := tx.Session(&gorm.Session{NewDB: true}).Where("kind = ? AND item_id = ? AND action = ?", "skill", name, "default")
	err := query.First(&rule).Error
	if err == nil {
		if !strings.HasPrefix(rule.ID, "cp_") {
			id := "cp_" + strings.ReplaceAll(uuid.NewString(), "-", "")
			updated := tx.Session(&gorm.Session{NewDB: true}).Model(&BillingRule{}).Where("id = ?", rule.ID).Update("id", id)
			if updated.Error != nil {
				return rule, updated.Error
			}
			if updated.RowsAffected == 1 {
				rule.ID = id
			} else {
				if err = tx.Session(&gorm.Session{NewDB: true}).Where("kind = ? AND item_id = ? AND action = ?", "skill", name, "default").First(&rule).Error; err != nil {
					return rule, err
				}
			}
		}
		return rule, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return rule, err
	}
	var skill Skill
	if err = tx.Session(&gorm.Session{NewDB: true}).Where("name = ? AND is_deleted = ?", name, false).First(&skill).Error; err != nil {
		return rule, err
	}
	if skill.TaskCredits < 0 || skill.TaskCredits > 1000000 || math.IsNaN(config.QuotaPerUnit) || math.IsInf(config.QuotaPerUnit, 0) || config.QuotaPerUnit <= 0 || config.QuotaPerUnit > float64(math.MaxInt64)/1000000 {
		return rule, errors.New("INVALID_PRICE")
	}
	quota := int64(float64(skill.TaskCredits) * config.QuotaPerUnit)
	if quota < 0 || config.QuotaPerUnit <= 0 {
		return rule, errors.New("INVALID_PRICE")
	}
	rule = BillingRule{ID: "cp_" + strings.ReplaceAll(uuid.NewString(), "-", ""), Kind: "skill", ItemID: name, Action: "default", Name: "技能调用", UnitQuota: quota, Enabled: true, Version: 1}
	if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rule).Error; err != nil {
		return rule, err
	}
	err = tx.Session(&gorm.Session{NewDB: true}).Where("kind = ? AND item_id = ? AND action = ?", "skill", name, "default").First(&rule).Error
	return rule, err
}

// AfterCreate initializes a free default point for newly added skills in the same transaction.
func (s *Skill) AfterCreate(tx *gorm.DB) error {
	if s.IsDeleted || !tx.Migrator().HasTable(&BillingRule{}) {
		return nil
	}
	_, err := EnsureSkillChargePoint(tx, s.Name)
	return err
}
