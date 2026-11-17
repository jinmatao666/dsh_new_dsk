package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"strconv"
)

func billingExempt(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": gin.H{"exempt": true, "state": "exempt", "reason": "credits_disabled"}})
}

// Resource access remains enforced by the resource owner, not arbitrary payer IDs.
func billingResourceAllowed(c *gin.Context, kind, item string) bool {
	switch kind {
	case "expert":
		value, ok := c.Get("billing.context")
		if ok && value.(model.BusinessBillingContext).ExpertKey == item {
			return true
		}
	case "skill":
		var skill model.Skill
		err := model.DB.Where("name = ? AND status = ? AND is_deleted = ?", item, 1, false).First(&skill).Error
		if err == nil {
			return true
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			billingError(c, err)
			return false
		}
		c.JSON(404, gin.H{"success": false, "code": "NOT_FOUND"})
		return false
	case "knowledge":
		id, err := strconv.Atoi(item)
		if err == nil && id > 0 {
			if _, err = model.GetAuthorizedKnowledgeBase(c.GetInt("id"), id, knowledgeAdmin(c)); err == nil {
				return true
			}
		}
	case model.BillingKindKnowledgeService:
		// The authenticated user's account pays; service/library entitlements stay
		// with the business owner. Expert-scoped credentials cannot access this scope.
		_, expertScoped := c.Get("billing.context")
		if item == model.BillingKnowledgeServiceID && c.GetInt("id") > 0 && !expertScoped {
			return true
		}
	}
	c.JSON(403, gin.H{"success": false, "code": "BILLING_SCOPE_MISMATCH"})
	return false
}
