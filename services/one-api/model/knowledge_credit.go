package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// KnowledgeCreditPrice stores per-file prices in hundredths of one credit.
type KnowledgeCreditPrice struct {
	KnowledgeBaseId int       `json:"knowledge_base_id" gorm:"primaryKey"`
	BrowseCents     int64     `json:"browse_cents"`
	QuestionCents   int64     `json:"question_cents"`
	DownloadCents   int64     `json:"download_cents"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// KnowledgeCreditReceipt commits the consumer debit and maintainer share together.
type KnowledgeCreditReceipt struct {
	Id                int64     `json:"id" gorm:"primaryKey"`
	UserId            int       `json:"user_id" gorm:"uniqueIndex:uk_knowledge_credit;index"`
	RequestId         string    `json:"request_id" gorm:"size:64;uniqueIndex:uk_knowledge_credit"`
	KnowledgeBaseId   int       `json:"knowledge_base_id" gorm:"uniqueIndex:uk_knowledge_credit"`
	DocumentId        string    `json:"document_id" gorm:"size:128;uniqueIndex:uk_knowledge_credit"`
	Action            string    `json:"action" gorm:"size:16;uniqueIndex:uk_knowledge_credit"`
	OwnerUserId       int       `json:"owner_user_id" gorm:"index"`
	LibraryName       string    `json:"library_name"`
	DocumentName      string    `json:"document_name"`
	Cents             int64     `json:"cents"`
	OwnerCents        int64     `json:"owner_cents"`
	PlatformCents     int64     `json:"platform_cents"`
	PlatformPercent   int       `json:"platform_percent"`
	BalanceAfter      int64     `json:"-"`
	OwnerBalanceAfter int64     `json:"-"`
	CreatedAt         time.Time `json:"created_at"`
}

// KnowledgePreviewAccess serializes a rolling 24-hour preview entitlement across devices.
type KnowledgePreviewAccess struct {
	UserId          int    `gorm:"primaryKey"`
	KnowledgeBaseId int    `gorm:"primaryKey"`
	DocumentId      string `gorm:"primaryKey;size:128"`
	PaidUntil       time.Time
}

// KnowledgeCreditQuestion prevents replaying a settled question or exposing an unpaid answer from history.
type KnowledgeCreditQuestion struct {
	Key         string `gorm:"primaryKey;size:64"`
	UserId      int    `gorm:"index"`
	BaseId      int
	SessionId   string `gorm:"index;size:128"`
	Fingerprint string `gorm:"size:64"`
	Result      string `gorm:"type:text"`
	CreatedAt   time.Time
}

// KnowledgeCreditLimits holds the maximum per-file price for each action, in hundredths.
type KnowledgeCreditLimits struct {
	BrowseCents   int64 `json:"browse_cents"`
	QuestionCents int64 `json:"question_cents"`
	DownloadCents int64 `json:"download_cents"`
}

const maxKnowledgeCreditCents = 100000000

// KnowledgeCreditSettings stores the platform share and price limits in one option.
type KnowledgeCreditSettings struct {
	Percent int                   `json:"platform_percent"`
	Limits  KnowledgeCreditLimits `json:"limits"`
}

// ReadKnowledgeCreditSettings reads the current policy, including defaults for existing deployments.
func ReadKnowledgeCreditSettings() (KnowledgeCreditSettings, error) {
	config.OptionMapRWMutex.RLock()
	percentText := config.OptionMap["KnowledgeCreditPlatformPercent"]
	raw := config.OptionMap["KnowledgeCreditSettings"]
	config.OptionMapRWMutex.RUnlock()
	settings := KnowledgeCreditSettings{Percent: 30, Limits: KnowledgeCreditLimits{maxKnowledgeCreditCents, maxKnowledgeCreditCents, maxKnowledgeCreditCents}}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &settings); err != nil {
			return settings, err
		}
	} else if percentText != "" {
		percent, err := strconv.Atoi(percentText)
		if err != nil {
			return settings, err
		}
		settings.Percent = percent
	}
	return settings, settings.Validate()
}

// Validate rejects platform shares and limits outside the supported ranges.
func (s KnowledgeCreditSettings) Validate() error {
	if s.Percent < 0 || s.Percent > 100 {
		return errors.New("平台占比须为 0 至 100 的整数")
	}
	for _, limit := range []int64{s.Limits.BrowseCents, s.Limits.QuestionCents, s.Limits.DownloadCents} {
		if limit < 0 || limit > maxKnowledgeCreditCents {
			return errors.New("最高积分须为 0 至 1,000,000，最多两位小数")
		}
	}
	return nil
}

// SaveKnowledgeCreditSettings validates and atomically persists the policy.
func SaveKnowledgeCreditSettings(settings KnowledgeCreditSettings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	return UpdateOption("KnowledgeCreditSettings", string(raw))
}

// LimitPrice applies the current caps to a saved price before it is displayed or charged.
func (s KnowledgeCreditLimits) LimitPrice(price KnowledgeCreditPrice) KnowledgeCreditPrice {
	price.BrowseCents = min(price.BrowseCents, s.BrowseCents)
	price.QuestionCents = min(price.QuestionCents, s.QuestionCents)
	price.DownloadCents = min(price.DownloadCents, s.DownloadCents)
	return price
}

// KnowledgeCreditPolicy returns edition gating and the administrator's platform percentage.
func KnowledgeCreditPolicy() (bool, int, error) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	var settings struct {
		Edition string `json:"edition"`
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil && raw != "" {
		return false, 0, err
	}
	settingsCredit, err := ReadKnowledgeCreditSettings()
	if err != nil {
		return false, 0, err
	}
	policy, err := config.ResolveCreditPolicy(raw)
	return (settings.Edition == "" || settings.Edition == "operations") && policy.Enabled, settingsCredit.Percent, err
}

// GetKnowledgeCreditPrice returns explicitly saved prices, or free prices when no price has been saved.
func GetKnowledgeCreditPrice(baseId int) (KnowledgeCreditPrice, bool, error) {
	row := KnowledgeCreditPrice{KnowledgeBaseId: baseId}
	err := DB.First(&row, "knowledge_base_id = ?", baseId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, false, nil
	}
	return row, err == nil, err
}

// SaveKnowledgeCreditPrice requires the original personal-library owner and integer hundredths.
func SaveKnowledgeCreditPrice(userId, baseId int, price KnowledgeCreditPrice) error {
	if price.BrowseCents < 0 || price.QuestionCents < 0 || price.DownloadCents < 0 || price.BrowseCents > 100000000 || price.QuestionCents > 100000000 || price.DownloadCents > 100000000 {
		return errors.New("单价须为 0 至 1,000,000 积分，最多两位小数")
	}
	settings, err := ReadKnowledgeCreditSettings()
	if err != nil {
		return err
	}
	if settings.Limits.LimitPrice(price) != price {
		return errors.New("单价超过管理员设置的最高积分")
	}
	var base KnowledgeBase
	if err := DB.First(&base, baseId).Error; err != nil {
		return err
	}
	if base.OwnerUserId != userId {
		return errors.New("仅知识库维护者可设置单价")
	}
	subscribed, err := knowledgeCreditSubscription(&base)
	if err != nil {
		return err
	}
	if !subscribed && (base.Kind != KnowledgeBasePersonal || base.CategoryId != 0 || base.PublicationScope != "") {
		return errors.New("仅个人库发布申请或订阅知识库可设置单价")
	}
	price.KnowledgeBaseId = baseId
	return DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "knowledge_base_id"}}, DoUpdates: clause.AssignmentColumns([]string{"browse_cents", "question_cents", "download_cents", "updated_at"})}).Create(&price).Error
}

// KnowledgeCreditApplies identifies subscriptions without billing personal owners or public-library viewers.
func KnowledgeCreditApplies(base *KnowledgeBase, userId int) (bool, error) {
	enabled, _, err := KnowledgeCreditPolicy()
	if err != nil || !enabled || base.OwnerUserId == userId {
		return false, err
	}
	return knowledgeCreditSubscription(base)
}

func knowledgeCreditSubscription(base *KnowledgeBase) (bool, error) {
	if base.PublicationScope != "" {
		return base.PublicationScope == "subscription", nil
	}
	if base.CategoryId == 0 {
		return false, nil
	}
	category, err := GetKnowledgeCategory(base.CategoryId)
	if err != nil {
		return false, err
	}
	return category.Type != KnowledgeBaseCommon || category.RequireAuth, nil
}

// KnowledgeCreditDocument is a validated referenced document, never a client-supplied price.
type KnowledgeCreditDocument struct {
	Id   string
	Name string
}

// KnowledgeCreditTerms captures the price and split before the upstream operation starts.
type KnowledgeCreditTerms struct {
	Price           KnowledgeCreditPrice
	PlatformPercent int
}

// ReadKnowledgeCreditTerms returns nil for non-billable libraries and their owners.
func ReadKnowledgeCreditTerms(base *KnowledgeBase, userId int) (*KnowledgeCreditTerms, error) {
	applies, err := KnowledgeCreditApplies(base, userId)
	if err != nil || !applies {
		return nil, err
	}
	settings, err := ReadKnowledgeCreditSettings()
	if err != nil {
		return nil, err
	}
	price, _, err := GetKnowledgeCreditPrice(base.Id)
	if err != nil {
		return nil, err
	}
	return &KnowledgeCreditTerms{Price: settings.Limits.LimitPrice(price), PlatformPercent: settings.Percent}, nil
}

// KnowledgePreviewPaidUntil returns the existing preview entitlement without extending it.
func KnowledgePreviewPaidUntil(userId, baseId int, documentId string) (time.Time, error) {
	var access KnowledgePreviewAccess
	err := DB.Where("user_id = ? AND knowledge_base_id = ? AND document_id = ?", userId, baseId, documentId).First(&access).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return time.Time{}, nil
	}
	return access.PaidUntil, err
}

// KnowledgeCreditQuestionPending reports whether the upstream session may contain an unpaid answer.
func KnowledgeCreditQuestionPending(sessionId string) (bool, error) {
	var count int64
	err := DB.Model(&KnowledgeCreditQuestion{}).Where("session_id = ? AND result = ''", sessionId).Count(&count).Error
	return count != 0, err
}

// BeginKnowledgeCreditQuestion claims a new question or replays its saved result without rerunning RAGFlow.
func BeginKnowledgeCreditQuestion(question *KnowledgeCreditQuestion, conversationId int) (string, error) {
	var result string
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Select("id").Where("id = ? AND ragflow_session_id = ?", conversationId, question.SessionId)
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var conversation KnowledgeConversation
		if err := query.First(&conversation).Error; err != nil {
			return err
		}
		var previous KnowledgeCreditQuestion
		err := tx.Where(&KnowledgeCreditQuestion{Key: question.Key}).First(&previous).Error
		if err == nil {
			if previous.Fingerprint != question.Fingerprint {
				return errors.New("问答请求编号已用于其他问题")
			}
			if previous.Result == "" {
				return errors.New("上次问答未结算，请清空会话后重试")
			}
			result = previous.Result
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var count int64
		if err := tx.Model(&KnowledgeCreditQuestion{}).Where("session_id = ? AND result = ''", question.SessionId).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errors.New("上次问答未结算，请清空会话后重试")
		}
		return tx.Create(question).Error
	})
	return result, err
}

// SettleKnowledgeCredits debits active quota and grants shares atomically; previews reuse an unextended entitlement.
// Document ids are deduplicated per request. An insufficient live ledger rolls back every receipt and reward.
func SettleKnowledgeCredits(userId int, base *KnowledgeBase, terms *KnowledgeCreditTerms, action, requestId string, documents []KnowledgeCreditDocument, questionKey, answer string) ([]KnowledgeCreditReceipt, error) {
	if terms == nil {
		return nil, nil
	}
	if action != "browse" && action != "question" && action != "download" {
		return nil, errors.New("知识库积分行为无效")
	}
	price, percent := terms.Price, terms.PlatformPercent
	cents := price.BrowseCents
	if action == "question" {
		cents = price.QuestionCents
	}
	if action == "download" {
		cents = price.DownloadCents
	}
	unit := config.QuotaPerUnit
	// Quota must exactly represent every hundredth; conversion must never mint or destroy credit value.
	if unit <= 0 || math.IsNaN(unit) || math.IsInf(unit, 0) || unit >= float64(math.MaxInt64) || unit != math.Trunc(unit) || int64(unit)%100 != 0 {
		return nil, errors.New("积分换算须能精确表示 0.01 积分")
	}
	quotaPerCent := int64(unit) / 100
	if quotaPerCent > math.MaxInt64/100000000 {
		return nil, errors.New("积分换算超出范围")
	}
	now := time.Now().UTC()
	receipts := []KnowledgeCreditReceipt{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if cents > 0 && len(documents) > 0 {
			ids := []int{userId, base.OwnerUserId}
			var users []User
			query := tx.Select("id", "account_type").Where("id IN ?", ids).Order("id")
			if !common.UsingSQLite {
				query = query.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := query.Find(&users).Error; err != nil {
				return err
			}
			if len(users) != 2 {
				return errors.New("知识库积分账户不存在")
			}
			for _, user := range users {
				if user.AccountType == AccountTypeEnterprise {
					return errors.New("企业账户不支持个人知识库积分结算")
				}
			}
		}
		seen := map[string]bool{}
		var totalCents int64
		for _, doc := range documents {
			if doc.Id == "" || seen[doc.Id] {
				continue
			}
			seen[doc.Id] = true
			var prior KnowledgeCreditReceipt
			found := tx.Where("user_id = ? AND request_id = ? AND knowledge_base_id = ? AND document_id = ? AND action = ?", userId, requestId, base.Id, doc.Id, action).First(&prior).Error
			if found == nil {
				receipts = append(receipts, prior)
				continue
			}
			if !errors.Is(found, gorm.ErrRecordNotFound) {
				return found
			}
			if action == "browse" {
				var access KnowledgePreviewAccess
				found := tx.Where("user_id = ? AND knowledge_base_id = ? AND document_id = ?", userId, base.Id, doc.Id).First(&access).Error
				if found != nil && !errors.Is(found, gorm.ErrRecordNotFound) {
					return found
				}
				if found == nil && access.PaidUntil.After(now) {
					continue
				}
			}
			cost := cents * quotaPerCent
			if err := debitUserQuotaTx(tx, userId, cost, true); err != nil {
				return err
			}
			share := int64(100 - percent)
			ownerCents := ((totalCents+cents)*share+50)/100 - (totalCents*share+50)/100
			totalCents += cents
			row := KnowledgeCreditReceipt{UserId: userId, RequestId: requestId, KnowledgeBaseId: base.Id, DocumentId: doc.Id, Action: action, OwnerUserId: base.OwnerUserId, LibraryName: base.Name, DocumentName: doc.Name, Cents: cents, OwnerCents: ownerCents, PlatformCents: cents - ownerCents, PlatformPercent: percent, CreatedAt: now}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			if ownerCents > 0 {
				if err := AddUserTimedQuotaTx(tx, base.OwnerUserId, ownerCents*quotaPerCent, "knowledge", fmt.Sprint(row.Id), nil); err != nil {
					return err
				}
			}
			var consumer, owner User
			if err := tx.Select("quota").First(&consumer, userId).Error; err != nil {
				return err
			}
			if err := tx.Select("quota").First(&owner, base.OwnerUserId).Error; err != nil {
				return err
			}
			row.BalanceAfter = consumer.Quota
			row.OwnerBalanceAfter = owner.Quota
			if err := tx.Model(&row).Updates(map[string]interface{}{"balance_after": row.BalanceAfter, "owner_balance_after": row.OwnerBalanceAfter}).Error; err != nil {
				return err
			}
			receipts = append(receipts, row)
			if action == "browse" && cents > 0 {
				access := KnowledgePreviewAccess{UserId: userId, KnowledgeBaseId: base.Id, DocumentId: doc.Id, PaidUntil: now.Add(24 * time.Hour)}
				if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "knowledge_base_id"}, {Name: "document_id"}}, DoUpdates: clause.AssignmentColumns([]string{"paid_until"})}).Create(&access).Error; err != nil {
					return err
				}
			}
		}
		if questionKey != "" {
			saved := tx.Model(&KnowledgeCreditQuestion{}).Where(&KnowledgeCreditQuestion{Key: questionKey}).Where("result = ?", "").Update("result", answer)
			if saved.Error != nil {
				return saved.Error
			}
			if saved.RowsAffected != 1 {
				return errors.New("问答结算已处理")
			}
		}
		return nil
	})
	if err == nil {
		InvalidateUserAccountCache(userId)
		InvalidateUserAccountCache(base.OwnerUserId)
	}
	return receipts, err
}
