package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math/big"
	"net/http"
	"strings"
)

func billingError(c *gin.Context, err error) {
	code := err.Error()
	status := http.StatusBadRequest
	switch code {
	case "INSUFFICIENT_CREDITS":
		status = 403
	case "PRICE_CHANGED", "REQUEST_CONFLICT", "TERMINAL_CONFLICT":
		status = 409
	case "TASK_NOT_FOUND":
		status = 404
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		status = 404
		code = "NOT_FOUND"
	}
	if status == 400 && code != "INVALID_REQUEST" && code != "INVALID_STATUS" && code != "BILLING_DISABLED" {
		status = 500
		code = "BILLING_UNAVAILABLE"
		logger.Error(c.Request.Context(), "business billing failed: "+err.Error())
	}
	c.JSON(status, gin.H{"success": false, "code": code, "message": code})
}
func validBillingAction(kind, item, action string) bool {
	return (kind == "expert" || kind == "skill" || kind == "knowledge") && len(item) > 0 && len(item) <= 160 && len(action) > 0 && len(action) <= 80
}

// GetBillingQuote returns a configured action price; the caller cannot set a debit amount.
func GetBillingQuote(c *gin.Context) {
	kind, item, action := c.Query("kind"), c.Query("item_id"), c.Query("action")
	if value, ok := c.Get("billing.context"); ok {
		scope := value.(model.BusinessBillingContext)
		if (kind != "" && kind != "expert") || (item != "" && item != scope.ExpertKey) {
			c.JSON(403, gin.H{"success": false, "code": "BILLING_SCOPE_MISMATCH"})
			return
		}
		kind, item = "expert", scope.ExpertKey
	}

	if config.CreditsDisabled() {
		billingExempt(c)
		return
	}
	if !billingResourceAllowed(c, kind, item) {
		return
	}
	point := c.Query("charge_point_id")
	if point == "" && kind == "skill" && c.Query("default") == "true" {
		rule, err := model.EnsureSkillChargePoint(model.DB, item)
		if err != nil {
			billingError(c, err)
			return
		}
		point = rule.ID
	}
	var err error
	action, err = resolveChargePoint(kind, item, point)
	if err != nil {
		billingError(c, err)
		return
	}

	if !validBillingAction(kind, item, action) {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	rule, err := model.ResolveBusinessRule(model.DB, kind, item, action)
	if err != nil {
		billingError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": gin.H{"rule": rule, "unit_credits": float64(rule.UnitQuota) / config.QuotaPerUnit, "quota_per_credit": config.QuotaPerUnit, "exempt": !rule.Enabled || rule.UnitQuota == 0}})
}

// PutBillingRule is administrator-only; version checks prevent lost price changes.
func PutBillingRule(c *gin.Context) {
	var input struct {
		Kind    string `json:"kind"`
		ItemID  string `json:"item_id"`
		Action  string `json:"action"`
		Credits string `json:"credits"`
		Enabled bool   `json:"enabled"`
		Version int64  `json:"version"`
	}
	if c.ShouldBindJSON(&input) != nil || !validBillingAction(input.Kind, input.ItemID, input.Action) {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	credits, ok := new(big.Rat).SetString(input.Credits)
	if !ok || credits.Sign() < 0 || credits.Cmp(big.NewRat(1000000, 1)) > 0 || config.QuotaPerUnit <= 0 {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	credits.Mul(credits, new(big.Rat).SetFloat64(config.QuotaPerUnit))
	if !credits.IsInt() || !credits.Num().IsInt64() {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	rule := model.BillingRule{ID: uuid.NewString(), Kind: input.Kind, ItemID: input.ItemID, Action: input.Action, UnitQuota: credits.Num().Int64(), Enabled: input.Enabled, Version: 1}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var prior model.BillingRule
		err := tx.Where("kind = ? AND item_id = ? AND action = ?", rule.Kind, rule.ItemID, rule.Action).First(&prior).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if input.Version != 0 {
				return errors.New("PRICE_CHANGED")
			}
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rule)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected != 1 {
				return errors.New("PRICE_CHANGED")
			}
			return nil
		}
		if err != nil {
			return err
		}
		if prior.IsDeleted || prior.Version != input.Version {
			return errors.New("PRICE_CHANGED")
		}
		rule.ID = prior.ID
		rule.Version = prior.Version + 1
		changed := tx.Model(&model.BillingRule{}).Where("id = ? AND version = ? AND is_deleted = ?", prior.ID, prior.Version, false).Updates(map[string]interface{}{"unit_quota": rule.UnitQuota, "enabled": rule.Enabled, "version": rule.Version})
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected != 1 {
			return errors.New("PRICE_CHANGED")
		}
		return nil
	})
	if err != nil {
		billingError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": rule})
}

// ReserveBusinessBilling requires the paying user's platform authentication and quoted price version.
func ReserveBusinessBilling(c *gin.Context) {
	var request struct {
		ChargePointID string `json:"charge_point_id"`
		ExpertKey     string `json:"expert_key"`
		Mode          string `json:"mode"`
		Points        string `json:"points"`
		Description   string `json:"description"`
		Kind          string `json:"kind"`
		ItemID        string `json:"item_id"`
		Action        string `json:"action"`
		RequestID     string `json:"request_id"`
		Quantity      int64  `json:"quantity"`
		Version       int64  `json:"version"`
		SessionID     string `json:"session_id"`
		TurnID        *int   `json:"turn_id"`
	}
	var input model.BillingTask
	if c.ShouldBindJSON(&request) != nil {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	scopeValue, scoped := c.Get("billing.context")
	if scoped {
		scope := scopeValue.(model.BusinessBillingContext)
		if (request.Kind != "" && request.Kind != "expert") || (request.ItemID != "" && request.ItemID != scope.ExpertKey) {
			c.JSON(403, gin.H{"success": false, "code": "BILLING_SCOPE_MISMATCH"})
			return
		}
		request.Kind, request.ItemID = "expert", scope.ExpertKey
	}
	if config.CreditsDisabled() {
		billingExempt(c)
		return
	}
	if !billingResourceAllowed(c, request.Kind, request.ItemID) {
		return
	}
	if request.ExpertKey != "" || request.Points != "" || request.Mode == "developer" {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	var resolveErr error
	request.Action, resolveErr = resolveChargePoint(request.Kind, request.ItemID, request.ChargePointID)
	if resolveErr != nil {
		billingError(c, resolveErr)
		return
	}

	if !validBillingAction(request.Kind, request.ItemID, request.Action) || len([]rune(request.Description)) > 160 {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	if request.Mode != "" && request.Mode != "configured" && request.Mode != "developer" {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	if request.Mode == "developer" && !scoped {
		c.JSON(403, gin.H{"success": false, "code": "DEVELOPER_SCOPE_REQUIRED"})
		return
	}
	input = model.BillingTask{Kind: request.Kind, ItemID: request.ItemID, Action: request.Action, RequestID: request.RequestID, Quantity: request.Quantity, Version: request.Version}
	input.Description = request.Description
	if len(request.SessionID) > 128 || request.TurnID != nil && (*request.TurnID < 0 || request.SessionID == "") {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	input.SessionID, input.TurnID = request.SessionID, request.TurnID
	var task model.BillingTask
	var secret string
	var err error
	task, secret, err = model.ReserveBillingTask(c.GetInt("id"), input)
	if err != nil && err.Error() == "BILLING_DISABLED" {
		billingExempt(c)
		return
	}
	if err != nil {
		billingError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": task, "task_token": secret})
}

// ResultBusinessBilling uses only a per-task capability, never an arbitrary user ID.
func ResultBusinessBilling(c *gin.Context) {
	var input struct {
		Status string `json:"status"`
	}
	secret := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if len(secret) != 72 {
		c.JSON(404, gin.H{"success": false, "code": "TASK_NOT_FOUND"})
		return
	}
	if c.ShouldBindJSON(&input) != nil {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	task, err := model.SettleBillingTask(c.Param("id"), secret, input.Status, false)
	if err != nil {
		billingError(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": task})
}

func GetBusinessBilling(c *gin.Context) {
	var task model.BillingTask
	if err := model.DB.Where("id = ? AND user_id = ?", c.Param("id"), c.GetInt("id")).First(&task).Error; err != nil {
		billingError(c, err)
		return
	}
	if value, ok := c.Get("billing.context"); ok {
		scope := value.(model.BusinessBillingContext)
		if task.Kind != "expert" || task.ItemID != scope.ExpertKey {
			c.JSON(404, gin.H{"success": false, "code": "TASK_NOT_FOUND"})
			return
		}
	}
	if !billingResourceAllowed(c, task.Kind, task.ItemID) {
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": task})
}
