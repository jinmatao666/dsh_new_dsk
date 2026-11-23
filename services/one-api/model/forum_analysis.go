package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const BillingKindForum = "planning_lecture"

// ForumAnalysis keeps successful answers and the corresponding unified billing receipt.
// A lease authorizes only its owner to finish one attempt; duplicate callers never receive it.
type ForumAnalysis struct {
	ID           string    `json:"id" gorm:"primaryKey;size:64"`
	UserID       int       `json:"-" gorm:"uniqueIndex:forum_question"`
	QuestionKey  string    `json:"-" gorm:"uniqueIndex:forum_question;size:64"`
	Action       string    `json:"action"`
	SessionID    string    `json:"-" gorm:"uniqueIndex;size:128"`
	TaskID       string    `json:"task_id"`
	LeaseHash    string    `json:"-"`
	RelayClaimed bool      `json:"-"`
	ManagedModel string    `json:"-"`
	State        string    `json:"state"`
	Text         string    `json:"text" gorm:"type:text"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	ExpiresAt    time.Time `json:"-"`
}

// ForumQuestionKey excludes conversation history and model choice so a successful
// answer is reused across refreshes for the same user, source and question.
func ForumQuestionKey(itemType, itemID, question, action string) (string, error) {
	if (itemType != "article" && itemType != "report") || strings.TrimSpace(itemID) == "" || len(itemID) > 160 || len(question) > 8000 || strings.TrimSpace(question) == "" || (action != "qa" && action != "report") {
		return "", errors.New("INVALID_REQUEST")
	}
	data, _ := json.Marshal([]string{itemType, itemID, strings.Join(strings.Fields(question), " "), action})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// EnsureForumRules creates both administrator-owned prices at one point each.
func EnsureForumRules(tx *gorm.DB) ([]BillingRule, error) {
	quota, err := BillingPointsQuota("1")
	if err != nil {
		return nil, err
	}
	for _, point := range []struct{ action, name string }{{"qa", "弹框问答"}, {"report", "生成报告"}} {
		rule := BillingRule{ID: "cp_forum_" + point.action, Kind: BillingKindForum, ItemID: "default", Action: point.action, Name: point.name, UnitQuota: quota, Enabled: true, Version: 1}
		if err := tx.Session(&gorm.Session{NewDB: true}).Clauses(clause.OnConflict{DoNothing: true}).Create(&rule).Error; err != nil {
			return nil, err
		}
	}
	var rules []BillingRule
	err = tx.Session(&gorm.Session{NewDB: true}).Where("kind = ? AND item_id = ?", BillingKindForum, "default").Order("action").Find(&rules).Error
	return rules, err
}

// BeginForumAnalysis reserves the configured fee and persists the attempt together.
// Pending attempts are not restarted; expired or failed attempts may be retried.
func BeginForumAnalysis(userID int, key, action, sessionID, managedModel string, version int64) (ForumAnalysis, string, error) {
	var result ForumAnalysis
	var lease string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := billingLock(tx).First(&user, userID).Error; err != nil {
			return err
		}
		err := billingLock(tx).Where("user_id = ? AND question_key = ?", userID, key).First(&result).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && result.State == "succeeded" {
			return nil
		}
		if err == nil && result.State == "running" {
			if time.Now().Before(result.ExpiresAt) {
				return errors.New("ANALYSIS_PENDING")
			}
			if result.TaskID != "" {
				var task BillingTask
				if err := tx.First(&task, "id = ?", result.TaskID).Error; err != nil {
					return err
				}
				if task.State == "reserved" {
					if _, err := settleBillingTaskDB(tx, task.ID, "", "expired", true); err != nil {
						return err
					}
				}
			}
		}
		if result.ID == "" {
			result.ID = uuid.NewString()
		}
		result.UserID, result.QuestionKey, result.Action = userID, key, action
		result.SessionID, result.ManagedModel, result.State = sessionID, managedModel, "running"
		result.Text, result.Provider, result.Model, result.TaskID = "", "", "", ""
		result.RelayClaimed = false
		result.ExpiresAt = time.Now().Add(30 * time.Minute)
		lease = uuid.NewString() + uuid.NewString()
		if !config.CreditsDisabled() {
			rules, err := EnsureForumRules(tx)
			if err != nil {
				return err
			}
			var rule BillingRule
			for _, candidate := range rules {
				if candidate.Action == action {
					rule = candidate
				}
			}
			if rule.ID == "" || rule.Version != version {
				return errors.New("PRICE_CHANGED")
			}
			turn := 0
			task, secret, err := reserveBusinessTaskDB(tx, userID, BillingTask{Kind: BillingKindForum, ItemID: "default", Action: action, RequestID: "forum:" + result.ID + ":" + strings.ReplaceAll(uuid.NewString(), "-", ""), Quantity: 1, Version: version, PricingMode: "configured", SessionID: sessionID, TurnID: &turn}, nil)
			if err != nil {
				return err
			}
			result.TaskID, lease, result.ExpiresAt = task.ID, secret, task.ExpiresAt
		}
		result.LeaseHash = BillingDigest(lease)
		return tx.Save(&result).Error
	})
	if err == nil {
		InvalidateUserAccountCache(userID)
	}
	return result, lease, err
}

// FinishForumAnalysis commits the answer with settlement, or refunds a failed attempt.
// A completed answer never changes on repeated completion requests.
func FinishForumAnalysis(userID int, id, lease, status, text, provider, modelName string) (ForumAnalysis, error) {
	var result ForumAnalysis
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := billingLock(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if err := billingLock(tx).Where("id = ? AND user_id = ?", id, userID).First(&result).Error; err != nil {
			return err
		}
		if BillingDigest(lease) != result.LeaseHash {
			return errors.New("TASK_NOT_FOUND")
		}
		if result.State == status {
			return nil
		}
		if result.State != "running" {
			return errors.New("TERMINAL_CONFLICT")
		}
		if status != "succeeded" && status != "failed" && status != "cancelled" {
			return errors.New("INVALID_STATUS")
		}
		if status == "succeeded" && (strings.TrimSpace(text) == "" || len(text) > 120000 || provider == "" || modelName == "" || len(provider) > 160 || len(modelName) > 200) {
			return errors.New("INVALID_REQUEST")
		}
		if result.TaskID != "" {
			task, err := settleBillingTaskDB(tx, result.TaskID, lease, status, false)
			if err != nil {
				return err
			}
			if task.State != status {
				return errors.New("TASK_EXPIRED")
			}
		} else if time.Now().After(result.ExpiresAt) {
			return errors.New("TASK_EXPIRED")
		}
		result.State = status
		if status == "succeeded" {
			result.Text, result.Provider, result.Model = text, provider, modelName
		}
		return tx.Save(&result).Error
	})
	if err == nil {
		InvalidateUserAccountCache(userID)
	}
	return result, err
}

// ClaimForumModelCall permits one bounded text request for the account's reserved analysis.
// Session attribution alone never exempts an unrelated or repeated request.
func ClaimForumModelCall(userID int, sessionID, modelName string) (string, error) {
	if sessionID == "" {
		return "", nil
	}
	var result ForumAnalysis
	err := DB.Where("user_id = ? AND session_id = ?", userID, sessionID).First(&result).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if result.ManagedModel == "" {
		return "", errors.New("INVALID_FORUM_MODEL")
	}
	if result.ManagedModel != modelName || result.State != "running" || result.RelayClaimed || time.Now().After(result.ExpiresAt) {
		return "", errors.New("INVALID_FORUM_MODEL")
	}
	if result.TaskID != "" {
		var task BillingTask
		if err := DB.Where("id = ? AND user_id = ? AND state = ? AND expires_at > ?", result.TaskID, userID, "reserved", time.Now()).First(&task).Error; err != nil {
			return "", err
		}
	}
	changed := DB.Model(&ForumAnalysis{}).Where("id = ? AND state = ? AND relay_claimed = ?", result.ID, "running", false).Update("relay_claimed", true)
	if changed.Error != nil {
		return "", changed.Error
	}
	if changed.RowsAffected != 1 {
		return "", errors.New("INVALID_FORUM_MODEL")
	}
	return result.ID, nil
}
