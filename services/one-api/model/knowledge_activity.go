package model

import (
	"time"

	"gorm.io/gorm"
)

// KnowledgeActivity preserves library and actor details when resources are renamed or deleted.
type KnowledgeActivity struct {
	ApplicantId       int       `json:"applicant_id"`
	Id                int64     `json:"id" gorm:"primaryKey"`
	Tab               string    `json:"tab" gorm:"index;size:16"`
	Action            string    `json:"action" gorm:"size:32"`
	KnowledgeBaseId   int       `json:"knowledge_base_id" gorm:"index"`
	KnowledgeBaseName string    `json:"knowledge_base_name"`
	CreatorId         int       `json:"creator_id"`
	ActorId           int       `json:"actor_id"`
	SourceName        string    `json:"source_name"`
	DocumentName      string    `json:"document_name"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"created_at" gorm:"index"`
}

// RecordKnowledgeActivity writes an event in the caller's transaction.
func RecordKnowledgeActivity(tx *gorm.DB, base *KnowledgeBase, actor int, action, tab, source, document, status string) error {
	return tx.Create(&KnowledgeActivity{
		Tab: tab, Action: action, KnowledgeBaseId: base.Id, KnowledgeBaseName: base.Name,
		CreatorId: base.OwnerUserId, ActorId: actor, SourceName: source, DocumentName: document, Status: status,
	}).Error
}

// RecordKnowledgeReviewActivity snapshots a publication or subscription review atomically.
func RecordKnowledgeReviewActivity(tx *gorm.DB, baseId, actor, applicant int, action, status string) error {
	var base KnowledgeBase
	if err := tx.First(&base, baseId).Error; err != nil {
		return err
	}
	return tx.Create(&KnowledgeActivity{
		Tab:               "personal",
		Action:            action,
		KnowledgeBaseId:   base.Id,
		KnowledgeBaseName: base.Name,
		CreatorId:         base.OwnerUserId,
		ActorId:           actor,
		ApplicantId:       applicant,
		Status:            status,
	}).Error
}

// DeleteKnowledgeBaseWithActivity preserves the deletion event in the local deletion transaction.
func DeleteKnowledgeBaseWithActivity(base *KnowledgeBase, actor int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var stored KnowledgeBase
		if err := tx.First(&stored, base.Id).Error; err != nil {
			return err
		}
		if err := RecordKnowledgeActivity(tx, &stored, actor, "delete_base", "personal", "", "", "success"); err != nil {
			return err
		}
		return deleteKnowledgeBaseRecords(tx, base.Id)
	})
}

// DeleteKnowledgeCategoryWithActivity records a category deletion after its libraries are removed.
func DeleteKnowledgeCategoryWithActivity(category *KnowledgeCategory, actor int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&KnowledgeCategory{}, category.Id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		target := KnowledgeBase{Name: category.Name, OwnerUserId: category.OwnerUserId}
		return RecordKnowledgeActivity(tx, &target, actor, "delete_category", "personal", "", "", "success")
	})
}
