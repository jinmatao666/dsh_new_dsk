package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"gorm.io/gorm"
)

// KnowledgeCreditReservation retains the unified task capability for retries and release.
// Credentials stay in the backend database and are never returned to clients.
type KnowledgeCreditReservation struct {
	Key        string    `gorm:"primaryKey;size:64" json:"-"`
	UserId     int       `gorm:"index" json:"-"`
	BaseId     int       `json:"-"`
	RequestId  string    `json:"-"`
	Action     string    `json:"-"`
	DocumentId string    `json:"-"`
	TaskId     string    `gorm:"uniqueIndex" json:"-"`
	Token      string    `json:"-"`
	Terms      string    `gorm:"type:text" json:"-"`
	CreatedAt  time.Time `json:"-"`
}

func knowledgeReservationKey(userId, baseId int, action, requestId, documentId string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d/%d/%s/%s/%s", userId, baseId, action, requestId, documentId)))
	return hex.EncodeToString(sum[:])
}

func reserveKnowledgeCreditsTx(tx *gorm.DB, userId int, base *KnowledgeBase, terms *KnowledgeCreditTerms, action, requestId, documentId string) (KnowledgeCreditReservation, error) {
	key := knowledgeReservationKey(userId, base.Id, action, requestId, documentId)
	var row KnowledgeCreditReservation
	err := tx.First(&row, "key = ?", key).Error
	if err == nil || !errors.Is(err, gorm.ErrRecordNotFound) {
		return row, err
	}
	cents := terms.Price.BrowseCents
	if action == "question" {
		cents = terms.Price.QuestionCents
	}
	if action == "download" {
		cents = terms.Price.DownloadCents
	}
	quota, err := BillingPointsQuota(fmt.Sprintf("%d.%02d", cents/100, cents%100))
	if err != nil {
		return row, errors.New("知识库单次单价须在 0 至 1000 积分内")
	}
	input := BillingTask{Kind: "knowledge", ItemID: strconv.Itoa(base.Id), Action: action, RequestID: "knowledge-" + key, Quantity: 1, PricingMode: "knowledge", ResourceName: base.Name, PointName: map[string]string{"browse": "知识库浏览", "download": "知识库下载", "question": "知识库问答溯源"}[action]}
	task, token, err := reserveBusinessTaskDB(tx, userId, input, &quota)
	if err != nil {
		return row, err
	}
	if task.State != "reserved" || token == "" {
		return row, errors.New("知识库计费任务已结束，请核对原操作")
	}
	raw, err := json.Marshal(terms)
	if err != nil {
		return row, err
	}
	row = KnowledgeCreditReservation{Key: key, UserId: userId, BaseId: base.Id, RequestId: requestId, Action: action, DocumentId: documentId, TaskId: task.ID, Token: token, Terms: string(raw)}
	return row, tx.Create(&row).Error
}

// ReserveKnowledgeCredits reserves one file price before fetching paid content.
// Questions reserve one reference initially; additional references settle with the saved answer.
func ReserveKnowledgeCredits(userId int, base *KnowledgeBase, terms *KnowledgeCreditTerms, action, requestId, documentId string) error {
	if terms == nil {
		return nil
	}
	if action != "browse" && action != "question" && action != "download" {
		return errors.New("知识库积分行为无效")
	}
	var accounts []User
	if err := DB.Select("id", "account_type").Where("id IN ?", []int{userId, base.OwnerUserId}).Find(&accounts).Error; err != nil {
		return err
	}
	if len(accounts) != 2 {
		return errors.New("知识库积分账户不存在")
	}
	for _, account := range accounts {
		if account.AccountType == AccountTypeEnterprise {
			return errors.New("企业账户不支持个人知识库积分结算")
		}
	}
	if action != "question" {
		var count int64
		if err := DB.Model(&KnowledgeCreditReceipt{}).Where("user_id = ? AND knowledge_base_id = ? AND action = ? AND request_id = ? AND document_id = ?", userId, base.Id, action, requestId, documentId).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
	}
	if action == "browse" {
		until, err := KnowledgePreviewPaidUntil(userId, base.Id, documentId)
		if err != nil || until.After(time.Now()) {
			return err
		}
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		row, err := reserveKnowledgeCreditsTx(tx, userId, base, terms, action, requestId, documentId)
		if err != nil {
			return err
		}
		var task BillingTask
		if err := tx.First(&task, "id = ?", row.TaskId).Error; err != nil {
			return err
		}
		if task.State != "reserved" && task.State != "succeeded" {
			return errors.New("知识库计费任务已释放，请重新发起操作")
		}
		return nil
	})
	if err == nil {
		InvalidateUserAccountCache(userId)
	}
	return err
}

// ReleaseKnowledgeCredits returns an unfinished operation's reserve to its original ledger sources.
func ReleaseKnowledgeCredits(userId, baseId int, action, requestId, documentId, status string) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		var row KnowledgeCreditReservation
		err := tx.First(&row, "key = ?", knowledgeReservationKey(userId, baseId, action, requestId, documentId)).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		_, err = settleBillingTaskDB(tx, row.TaskId, row.Token, status, false)
		return err
	})
	if err == nil {
		InvalidateUserAccountCache(userId)
	}
	return err
}

// RecoverKnowledgeCreditAnswers settles persisted answers with their original task and price.
// The minute worker never reruns questions or replaces expired reservations with new charges.
func RecoverKnowledgeCreditAnswers() error {
	var questions []KnowledgeCreditQuestion
	if err := DB.Table("knowledge_credit_questions AS q").Select("q.*").
		Joins("JOIN knowledge_credit_reservations AS r ON r.user_id = q.user_id AND r.base_id = q.base_id AND r.request_id = q.request_id AND r.action = ? AND r.document_id = ?", "question", "").
		Joins("JOIN billing_tasks AS t ON t.id = r.task_id AND t.state = ?", "reserved").
		Where("q.answer <> '' AND q.result = ''").Order("q.created_at").Limit(100).Find(&questions).Error; err != nil {
		return err
	}
	var firstError error
	for _, question := range questions {
		var reservation KnowledgeCreditReservation
		err := DB.First(&reservation, "key = ?", knowledgeReservationKey(question.UserId, question.BaseId, "question", question.RequestId, "")).Error
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		var task BillingTask
		if err := DB.First(&task, "id = ?", reservation.TaskId).Error; err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if task.State != "reserved" {
			continue
		}
		var terms KnowledgeCreditTerms
		var data struct {
			Citations []struct {
				Id   string `json:"document_id"`
				Name string `json:"document_name"`
			} `json:"citations"`
		}
		if err := json.Unmarshal([]byte(reservation.Terms), &terms); err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if err := json.Unmarshal([]byte(question.Answer), &data); err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		base, err := GetKnowledgeBase(question.BaseId)
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		documents := make([]KnowledgeCreditDocument, 0, len(data.Citations))
		for _, citation := range data.Citations {
			documents = append(documents, KnowledgeCreditDocument{Id: citation.Id, Name: citation.Name})
		}
		if _, err := SettleKnowledgeCredits(question.UserId, base, &terms, "question", question.RequestId, documents, question.Key, question.Answer); err != nil && firstError == nil {
			firstError = err
		}
	}
	return firstError
}
