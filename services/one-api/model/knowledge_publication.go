package model

import (
	"errors"
	"gorm.io/gorm"
	"strings"
	"time"
	"unicode/utf8"
)

// KnowledgePublicationApplication is the latest owner request to publish a personal library.
// Rejected requests may be resubmitted; pending requests never change library visibility.
type KnowledgePublicationApplication struct {
	Id              int        `json:"id" gorm:"primaryKey"`
	KnowledgeBaseId int        `json:"knowledge_base_id" gorm:"uniqueIndex;not null"`
	ApplicantUserId int        `json:"applicant_user_id" gorm:"index;not null"`
	Target          string     `json:"target"`
	Status          string     `json:"status" gorm:"index;not null"`
	Reason          string     `json:"reason" gorm:"type:varchar(500)"`
	ReviewNote      string     `json:"review_note" gorm:"type:varchar(500)"`
	ReviewedBy      int        `json:"reviewed_by"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// KnowledgePublicationItem adds names for the administrator's review inbox.
type KnowledgePublicationItem struct {
	KnowledgePublicationApplication
	KnowledgeBaseName string `json:"knowledge_base_name"`
	ApplicantUsername string `json:"applicant_username"`
}

// ErrKnowledgePublicationInvalid indicates a request whose library or target cannot be published.
var ErrKnowledgePublicationInvalid = errors.New("该知识库或发布范围不支持发布申请")

// ErrKnowledgePublicationPending indicates a duplicate request or an already handled review.
var ErrKnowledgePublicationPending = errors.New("申请正在审核或已处理，请刷新后重试")

// GetKnowledgePublication returns the latest publication request, or nil when none exists.
func GetKnowledgePublication(baseId int) (*KnowledgePublicationApplication, error) {
	var row KnowledgePublicationApplication
	err := DB.Where("knowledge_base_id = ?", baseId).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

// ApplyKnowledgePublication records the owner's request without changing the library or its grants.
func ApplyKnowledgePublication(userId, baseId int, target, reason string) (*KnowledgePublicationApplication, error) {
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) > 500 || (target != "public" && target != "subscription") {
		return nil, ErrKnowledgePublicationInvalid
	}
	var result KnowledgePublicationApplication
	err := DB.Transaction(func(tx *gorm.DB) error {
		var base KnowledgeBase
		if err := tx.First(&base, baseId).Error; err != nil {
			return err
		}
		if base.OwnerUserId != userId || base.Kind != KnowledgeBasePersonal || base.CategoryId != 0 || base.PublicationScope != "" || base.Shelf != KnowledgeShelfPublished {
			return ErrKnowledgePublicationInvalid
		}
		result = KnowledgePublicationApplication{KnowledgeBaseId: baseId, ApplicantUserId: userId, Target: target, Status: KnowledgeSubscriptionPending, Reason: reason}
		var previous KnowledgePublicationApplication
		err := tx.Where("knowledge_base_id = ?", baseId).First(&previous).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&result).Error
		}
		if err != nil {
			return err
		}
		if previous.Status != KnowledgeSubscriptionRejected {
			return ErrKnowledgePublicationPending
		}
		result.Id = previous.Id
		result.CreatedAt = previous.CreatedAt
		changed := tx.Model(&previous).Where("status = ?", KnowledgeSubscriptionRejected).Select("target", "status", "reason", "review_note", "reviewed_by", "reviewed_at", "updated_at").Updates(&result)
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected != 1 {
			return ErrKnowledgePublicationPending
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// ReviewKnowledgePublication atomically settles a pending request and changes visibility only on approval.
// Personal ownership is checked again; the original library remains personal.
func ReviewKnowledgePublication(id, reviewerId int, approve bool, note string) (*KnowledgePublicationApplication, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > 500 || (!approve && note == "") {
		return nil, ErrKnowledgePublicationInvalid
	}
	var result KnowledgePublicationApplication
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&result, id).Error; err != nil {
			return err
		}
		status := KnowledgeSubscriptionRejected
		if approve {
			status = KnowledgeSubscriptionApproved
		}
		now := time.Now()
		claim := tx.Model(&result).Where("status = ?", KnowledgeSubscriptionPending).Updates(map[string]interface{}{"status": status, "reviewed_by": reviewerId, "reviewed_at": now, "review_note": note})
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected != 1 {
			return ErrKnowledgePublicationPending
		}
		if approve {
			if result.Target != "public" && result.Target != "subscription" {
				return ErrKnowledgePublicationInvalid
			}
			change := tx.Model(&KnowledgeBase{}).Where("id = ? AND owner_user_id = ? AND kind = ? AND category_id = 0 AND publication_scope = '' AND shelf = ?", result.KnowledgeBaseId, result.ApplicantUserId, KnowledgeBasePersonal, KnowledgeShelfPublished).Update("publication_scope", result.Target)
			if change.Error != nil {
				return change.Error
			}
			if change.RowsAffected != 1 {
				return ErrKnowledgePublicationInvalid
			}
		}
		if err := RecordKnowledgeReviewActivity(tx, result.KnowledgeBaseId, reviewerId, result.ApplicantUserId, "publish_"+result.Target, status); err != nil { return err }
		return tx.First(&result, id).Error
	})
	return &result, err
}

// ListKnowledgePublications returns paged review records with display names.
func ListKnowledgePublications(status string, page, size int) ([]KnowledgePublicationItem, int64, error) {
	query := DB.Model(&KnowledgePublicationApplication{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []KnowledgePublicationApplication
	if err := query.Order("updated_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := make([]KnowledgePublicationItem, 0, len(rows))
	ids := []int{}
	for _, row := range rows {
		ids = append(ids, row.ApplicantUserId)
	}
	names, err := userDisplayNames(ids)
	if err != nil {
		return nil, 0, err
	}
	for _, row := range rows {
		var base KnowledgeBase
		if err := DB.First(&base, row.KnowledgeBaseId).Error; err != nil {
			return nil, 0, err
		}
		items = append(items, KnowledgePublicationItem{KnowledgePublicationApplication: row, KnowledgeBaseName: base.Name, ApplicantUsername: names[row.ApplicantUserId]})
	}
	return items, total, nil
}

// RestorePersonalPublicationOrigins retains personal entry points for previously approved publication requests.
func RestorePersonalPublicationOrigins() error {
	var applications []KnowledgePublicationApplication
	if err := DB.Where("status = ?", KnowledgeSubscriptionApproved).Find(&applications).Error; err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		for _, app := range applications {
			if app.Target != "public" && app.Target != "subscription" {
				return ErrKnowledgePublicationInvalid
			}
			if err := tx.Model(&KnowledgeBase{}).Where("id = ? AND owner_user_id = ? AND publication_scope = ''", app.KnowledgeBaseId, app.ApplicantUserId).Updates(map[string]interface{}{"kind": KnowledgeBasePersonal, "category_id": 0, "publication_scope": app.Target}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// WithdrawKnowledgePublication restores owner-only access and removes subscription access.
func WithdrawKnowledgePublication(userId, baseId int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		changed := tx.Model(&KnowledgeBase{}).Where("id = ? AND owner_user_id = ? AND kind = ? AND category_id = 0 AND publication_scope IN ?", baseId, userId, KnowledgeBasePersonal, []string{"public", "subscription"}).Update("publication_scope", "")
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected != 1 {
			return ErrKnowledgePublicationInvalid
		}
		if err := tx.Where("knowledge_base_id = ?", baseId).Delete(&KnowledgeBaseGrant{}).Error; err != nil {
			return err
		}
		if err := tx.Where("knowledge_base_id = ?", baseId).Delete(&KnowledgeSubscriptionApplication{}).Error; err != nil {
			return err
		}
		return tx.Where("knowledge_base_id = ?", baseId).Delete(&KnowledgePublicationApplication{}).Error
	})
}
