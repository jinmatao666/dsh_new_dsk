package controller

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"math"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm/clause"
)

// Charge point administration uses the same rule store for all resource kinds.
func chargePointResource(c *gin.Context) (string, string, bool) {
	kind, item := c.Param("kind"), c.Param("item")
	if kind == "" {
		kind, item = "expert", c.Param("key")
	}
	var err error
	switch kind {
	case "expert":
		var row model.ExpertWebProfile
		err = model.DB.Where(map[string]interface{}{"key": item}).First(&row).Error
	case "skill":
		var row model.Skill
		err = model.DB.Where("name = ? AND is_deleted = ?", item, false).First(&row).Error
		if err == nil {
			_, err = model.EnsureSkillChargePoint(model.DB, item)
		}
	case "knowledge":
		var row model.KnowledgeBase
		err = model.DB.Where("id = ?", item).First(&row).Error
	default:
		err = errors.New("invalid resource kind")
	}
	if err != nil {
		c.JSON(404, gin.H{"success": false, "message": "资源不存在或不可用"})
		return "", "", false
	}
	return kind, item, true
}

var chargePointPricePattern = regexp.MustCompile(`^[0-9]+(?:[.][0-9]+)?$`)

func chargePointView(rule model.BillingRule) gin.H {
	return gin.H{"id": rule.ID, "kind": rule.Kind, "item_id": rule.ItemID, "name": rule.Name,
		"default":     rule.Kind == "skill" && rule.Action == "default",
		"description": rule.Description, "credits": float64(rule.UnitQuota) / config.QuotaPerUnit,
		"enabled": rule.Enabled, "version": rule.Version}
}

// AdminListChargePoints includes disabled points so administrators can retain audit history.
func AdminListChargePoints(c *gin.Context) {
	kind, item, ok := chargePointResource(c)
	if !ok {
		return
	}
	var rules []model.BillingRule
	if err := model.DB.Where("kind = ? AND item_id = ? AND substr(id,1,3) = ?", kind, item, "cp_").Order("updated_at DESC, id ASC").Find(&rules).Error; err != nil {
		c.JSON(500, gin.H{"success": false, "message": "读取扣分点失败"})
		return
	}
	items := make([]gin.H, 0, len(rules))
	for _, rule := range rules {
		items = append(items, chargePointView(rule))
	}
	c.JSON(200, gin.H{"success": true, "data": items})
}

// AdminSaveChargePoint creates immutable IDs and uses optimistic locking for price edits.
func AdminSaveChargePoint(c *gin.Context) {
	kind, item, ok := chargePointResource(c)
	if !ok {
		return
	}
	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Credits     string `json:"credits"`
		Enabled     *bool  `json:"enabled"`
		Version     int64  `json:"version"`
	}
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"success": false, "message": "扣分点格式错误"})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	amount, ok := new(big.Rat).SetString(input.Credits)
	if len(input.Credits) > 32 || !chargePointPricePattern.MatchString(input.Credits) || math.IsNaN(config.QuotaPerUnit) || math.IsInf(config.QuotaPerUnit, 0) || input.Name == "" || len([]rune(input.Name)) > 100 || len([]rune(input.Description)) > 500 || input.Enabled == nil || !ok || amount.Sign() < 0 || amount.Cmp(big.NewRat(1000000, 1)) > 0 || config.QuotaPerUnit <= 0 {
		c.JSON(400, gin.H{"success": false, "message": "请填写名称、有效积分和启用状态（积分范围 0～1000000）"})
		return
	}
	amount.Mul(amount, new(big.Rat).SetFloat64(config.QuotaPerUnit))
	if !amount.IsInt() || !amount.Num().IsInt64() {
		c.JSON(400, gin.H{"success": false, "message": "积分精度超出支持范围"})
		return
	}
	rule := model.BillingRule{ID: c.Param("point"), Kind: kind, ItemID: item, Name: input.Name, Description: input.Description, UnitQuota: amount.Num().Int64(), Enabled: *input.Enabled, Version: input.Version + 1, UpdatedAt: time.Now()}
	var err error
	if rule.ID == "" {
		rule.Version = 1
		// Keep IDs compact without exposing counters; retry a unique-key collision.
		for attempt := 0; attempt < 3; attempt++ {
			var random [6]byte
			if _, err = rand.Read(random[:]); err != nil {
				break
			}
			rule.ID = "cp_" + hex.EncodeToString(random[:])
			rule.Action = rule.ID
			result := model.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&rule)
			err = result.Error
			if err != nil || result.RowsAffected == 1 {
				break
			}
			err = errors.New("charge point ID collision")
		}
	} else {
		if !strings.HasPrefix(rule.ID, "cp_") {
			c.JSON(404, gin.H{"success": false, "message": "扣分点不存在"})
			return
		}
		rule.Action = rule.ID
		if kind == "skill" {
			var prior model.BillingRule
			if model.DB.Where("id = ? AND kind = ? AND item_id = ?", rule.ID, kind, item).First(&prior).Error == nil {
				rule.Action = prior.Action
			}
		}
		result := model.DB.Model(&model.BillingRule{}).Where("id = ? AND kind = ? AND item_id = ? AND version = ?", rule.ID, kind, rule.ItemID, input.Version).Updates(map[string]interface{}{"name": rule.Name, "description": rule.Description, "unit_quota": rule.UnitQuota, "enabled": rule.Enabled, "version": rule.Version, "updated_at": rule.UpdatedAt})
		err = result.Error
		if err == nil && result.RowsAffected != 1 {
			c.JSON(409, gin.H{"success": false, "message": "配置已变更或扣分点不存在，请刷新后重试"})
			return
		}
	}
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "保存扣分点失败"})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": chargePointView(rule)})
}

// resolveChargePoint never accepts a point belonging to another expert.
func resolveChargePoint(kind, expert, point string) (string, error) {
	var rule model.BillingRule
	if !validBillingAction(kind, expert, point) || !strings.HasPrefix(point, "cp_") {
		return "", errors.New("INVALID_REQUEST")
	}
	if err := model.DB.Where("id = ? AND kind = ? AND item_id = ?", point, kind, expert).First(&rule).Error; err != nil {
		return "", err
	}
	return rule.Action, nil
}
