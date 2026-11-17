package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"math/big"
	"regexp"
	"time"
)

type BillingRule struct {
	Name        string    `json:"name" gorm:"size:100"`
	Description string    `json:"description" gorm:"size:500"`
	ID          string    `json:"id" gorm:"primaryKey;size:64"`
	Kind        string    `json:"kind" gorm:"uniqueIndex:billing_action;size:16"`
	ItemID      string    `json:"item_id" gorm:"uniqueIndex:billing_action;size:160"`
	Action      string    `json:"action" gorm:"uniqueIndex:billing_action;size:80"`
	UnitQuota   int64     `json:"unit_quota"`
	Enabled     bool      `json:"enabled"`
	IsDeleted   bool      `json:"-" gorm:"not null;default:false"`
	Version     int64     `json:"version"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type BillingTask struct {
	ResourceName string     `json:"resource_name"`
	PointName    string     `json:"point_name"`
	SessionID    string     `json:"session_id,omitempty" gorm:"index:idx_billing_turn,priority:1"`
	TurnID       *int       `json:"turn_id,omitempty" gorm:"index:idx_billing_turn,priority:2"`
	PricingMode  string     `json:"pricing_mode"`
	Description  string     `json:"description"`
	ID           string     `json:"id" gorm:"primaryKey;size:64"`
	UserID       int        `json:"-" gorm:"uniqueIndex:billing_request;index"`
	RequestID    string     `json:"request_id" gorm:"uniqueIndex:billing_request;size:128"`
	Kind         string     `json:"kind"`
	ItemID       string     `json:"item_id"`
	Action       string     `json:"action"`
	Quantity     int64      `json:"quantity"`
	Version      int64      `json:"version"`
	Quota        int64      `json:"quota"`
	State        string     `json:"state" gorm:"index"`
	SecretHash   string     `json:"-"`
	Sources      string     `json:"-" gorm:"type:text"`
	BalanceAfter int64      `json:"balance_after"`
	CreatedAt    time.Time  `json:"created_at"`
	ExpiresAt    time.Time  `json:"expires_at" gorm:"index"`
	SettledAt    *time.Time `json:"settled_at"`
}

func BillingDigest(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
func billingLock(tx *gorm.DB) *gorm.DB {
	if common.UsingSQLite {
		return tx
	}
	return tx.Clauses(clause.Locking{Strength: "UPDATE"})
}

func ReserveBillingTask(userID int, input BillingTask) (BillingTask, string, error) {
	input.PricingMode = "configured"
	return reserveBusinessTask(userID, input)
}

var billingPointsPattern = regexp.MustCompile(`^[0-9]+(?:[.][0-9]+)?$`)

func BillingPointsQuota(points string) (int64, error) {
	if len(points) > 32 || !billingPointsPattern.MatchString(points) {
		return 0, errors.New("INVALID_REQUEST")
	}
	r, ok := new(big.Rat).SetString(points)
	if !ok || r.Sign() < 0 || r.Cmp(big.NewRat(1000, 1)) > 0 || config.QuotaPerUnit <= 0 || math.IsInf(config.QuotaPerUnit, 0) || math.IsNaN(config.QuotaPerUnit) {
		return 0, errors.New("INVALID_REQUEST")
	}
	r.Mul(r, new(big.Rat).SetFloat64(config.QuotaPerUnit))
	if !r.IsInt() || !r.Num().IsInt64() {
		return 0, errors.New("INVALID_REQUEST")
	}
	return r.Num().Int64(), nil
}

func reserveBusinessTask(userID int, input BillingTask) (BillingTask, string, error) {
	var result BillingTask
	secret := uuid.NewString() + uuid.NewString()
	if config.CreditsDisabled() {
		return result, "", errors.New("BILLING_DISABLED")
	}
	if input.Quantity < 1 || input.Quantity > 1000000 || input.RequestID == "" || len(input.RequestID) > 128 {
		return result, "", errors.New("INVALID_REQUEST")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := billingLock(tx).First(&user, userID).Error; err != nil {
			return err
		}
		err := tx.Where("user_id = ? AND request_id = ?", userID, input.RequestID).First(&result).Error
		if err == nil {
			if result.Kind != input.Kind || result.ItemID != input.ItemID || result.Action != input.Action || result.Quantity != input.Quantity || result.Version != input.Version || result.PricingMode != input.PricingMode || result.Description != input.Description || result.SessionID != input.SessionID || !sameBillingTurn(result.TurnID, input.TurnID) {
				return errors.New("REQUEST_CONFLICT")
			}
			secret = ""
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		amount := int64(0)
		{
			rule, err := ResolveBusinessRule(billingLock(tx), input.Kind, input.ItemID, input.Action)
			if err != nil {
				return err
			}

			if rule.Enabled && rule.UnitQuota > 0 && rule.Version != input.Version {
				return errors.New("PRICE_CHANGED")
			}
			if rule.UnitQuota < 0 || rule.UnitQuota > math.MaxInt64/input.Quantity {
				return errors.New("INVALID_PRICE")
			}
			amount = rule.UnitQuota * input.Quantity
			if !rule.Enabled {
				amount = 0
			}
			input.PointName = rule.Name
			if rule.Name != "" {
				input.ResourceName, err = BillingResourceName(tx, input.Kind, input.ItemID)
				if err != nil {
					return err
				}
			}
		}

		sources, err := changeTokenCreditQuotaDB(tx, userID, 0, amount, nil)
		if err != nil {
			return errors.New("INSUFFICIENT_CREDITS")
		}
		encoded, err := json.Marshal(sources)
		if err != nil {
			return err
		}
		result = input
		result.ID = uuid.NewString()
		result.UserID = userID
		result.Quota = amount
		result.State = "reserved"
		result.SecretHash = BillingDigest(secret)
		result.Sources = string(encoded)
		result.CreatedAt = time.Now()
		result.ExpiresAt = result.CreatedAt.Add(30 * time.Minute)
		result.BalanceAfter = user.Quota - amount
		return tx.Create(&result).Error
	})
	if err == nil {
		InvalidateUserAccountCache(userID)
	}
	return result, secret, err
}

func sameBillingTurn(a, b *int) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func SettleBillingTask(id, secret, status string, expiry bool) (BillingTask, error) {
	var result BillingTask
	if status != "succeeded" && status != "failed" && status != "cancelled" && !(expiry && status == "expired") {
		return result, errors.New("INVALID_STATUS")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var initial BillingTask
		if err := tx.First(&initial, "id = ?", id).Error; err != nil {
			return err
		}
		if !expiry && BillingDigest(secret) != initial.SecretHash {
			return errors.New("TASK_NOT_FOUND")
		}
		var user User
		if err := billingLock(tx).First(&user, initial.UserID).Error; err != nil {
			return err
		}
		if err := billingLock(tx).First(&result, "id = ?", id).Error; err != nil {
			return err
		}
		if result.State != "reserved" {
			if result.State == status {
				return nil
			}
			return errors.New("TERMINAL_CONFLICT")
		}
		if time.Now().After(result.ExpiresAt) {
			status = "expired"
		} else if expiry {
			return errors.New("NOT_EXPIRED")
		}
		if status != "succeeded" && result.Quota > 0 {
			var sources map[int64]int64
			if err := json.Unmarshal([]byte(result.Sources), &sources); err != nil {
				return err
			}
			if _, err := changeTokenCreditQuotaDB(tx, result.UserID, 0, -result.Quota, sources); err != nil {
				return err
			}
		}
		if status == "succeeded" && result.Quota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", result.UserID).Update("used_quota", gorm.Expr("used_quota + ?", result.Quota)).Error; err != nil {
				return err
			}
		}
		if err := tx.First(&user, result.UserID).Error; err != nil {
			return err
		}
		now := time.Now()
		result.State = status
		result.SettledAt = &now
		result.BalanceAfter = user.Quota
		return tx.Save(&result).Error
	})
	if err == nil {
		InvalidateUserAccountCache(result.UserID)
	}
	return result, err
}

func ExpireBillingTasks() error {
	if err := DB.Where("expires_at <= ?", time.Now()).Delete(&BusinessBillingContext{}).Error; err != nil {
		return err
	}

	var rows []BillingTask
	if err := DB.Where("state = ? AND expires_at <= ?", "reserved", time.Now()).Limit(100).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if _, err := SettleBillingTask(row.ID, "", "expired", true); err != nil && err.Error() != "TERMINAL_CONFLICT" {
			return err
		}
	}
	return nil
}

// ResolveBusinessRule uses an explicit action rule first, then the existing default task price.
func ResolveBusinessRule(tx *gorm.DB, kind, item, action string) (BillingRule, error) {
	var rule BillingRule
	// Isolate the optional rule lookup from an initialized locking statement:
	// ErrRecordNotFound must not poison the subsequent skill/expert fallback.
	err := tx.Session(&gorm.Session{}).Where("kind = ? AND item_id = ? AND action = ?", kind, item, action).First(&rule).Error
	if rule.IsDeleted {
		rule.Enabled, rule.UnitQuota = false, 0
	}
	if err == nil || !errors.Is(err, gorm.ErrRecordNotFound) {
		return rule, err
	}
	if action != "default" {
		return rule, err
	}
	var points int64
	switch kind {
	case "expert":
		var profile ExpertWebProfile
		if err := tx.Where(map[string]interface{}{"key": item, "published": true}).First(&profile).Error; err != nil {
			return rule, err
		}
		points = profile.TaskCredits
	case "skill":
		var skill Skill
		if err := tx.Where("name = ? AND status = ? AND is_deleted = ?", item, 1, false).First(&skill).Error; err != nil {
			return rule, err
		}
		points = skill.TaskCredits
	default:
		return rule, gorm.ErrRecordNotFound
	}
	if points < 0 || points > 1000000 || config.QuotaPerUnit <= 0 || config.QuotaPerUnit > float64(math.MaxInt64)/1000000 {
		return rule, errors.New("INVALID_PRICE")
	}
	quota := int64(float64(points) * config.QuotaPerUnit)
	return BillingRule{Kind: kind, ItemID: item, Action: action, Enabled: true, UnitQuota: quota, Version: quota + 1}, nil
}

// BusinessBillingContext binds a redeemed identity to one user and one expert.
type BusinessBillingContext struct {
	Hash         string `gorm:"primaryKey;size:64"`
	UserID       int
	ExpertKey    string
	ProviderHash string
	ExpiresAt    time.Time `gorm:"index"`
}
