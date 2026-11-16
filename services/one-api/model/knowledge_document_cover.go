package model

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// KnowledgeDocumentCover stores a PDF first-page image and its durable generation state.
type KnowledgeDocumentCover struct {
	KnowledgeBaseId int    `gorm:"primaryKey;autoIncrement:false"`
	DocumentId      string `gorm:"primaryKey;size:191"`
	Status          string `gorm:"not null;index:knowledge_cover_queue,priority:1"`
	NextAttempt     int64  `gorm:"not null;index:knowledge_cover_queue,priority:2"`
	Attempts        int    `gorm:"not null"`
	JPEG            []byte
}

// QueueKnowledgeDocumentCover creates one pending job per document.
func QueueKnowledgeDocumentCover(baseId int, documentId string) error {
	row := KnowledgeDocumentCover{KnowledgeBaseId: baseId, DocumentId: documentId, Status: "pending"}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}

// ClaimKnowledgeDocumentCover reserves an eligible job until the lease expires.
func ClaimKnowledgeDocumentCover(ctx context.Context, now time.Time, lease time.Duration) (*KnowledgeDocumentCover, error) {
	db := DB.WithContext(ctx)
	var row KnowledgeDocumentCover
	err := db.Select("knowledge_base_id", "document_id", "attempts", "next_attempt").
		Where("status = ? AND next_attempt <= ?", "pending", now.UnixMilli()).
		Order("next_attempt").Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	until := now.Add(lease).UnixMilli()
	result := db.Model(&row).Where("status = ? AND next_attempt = ? AND attempts = ?", "pending", row.NextAttempt, row.Attempts).
		Updates(map[string]interface{}{"next_attempt": until, "attempts": gorm.Expr("attempts + 1")})
	if result.Error != nil || result.RowsAffected != 1 {
		return nil, result.Error
	}
	row.NextAttempt = until
	row.Attempts++
	return &row, nil
}

// FinishKnowledgeDocumentCover updates the claimed row only while its lease identity still matches.
func FinishKnowledgeDocumentCover(ctx context.Context, row *KnowledgeDocumentCover, jpeg []byte, retryAt time.Time) error {
	status := "failed"
	next := int64(0)
	if len(jpeg) > 0 {
		status = "ready"
	} else if !retryAt.IsZero() {
		status = "pending"
		next = retryAt.UnixMilli()
	}
	return DB.WithContext(ctx).Model(row).Where("status = ? AND next_attempt = ? AND attempts = ?", "pending", row.NextAttempt, row.Attempts).
		Updates(map[string]interface{}{"status": status, "next_attempt": next, "jpeg": jpeg}).Error
}

// ListKnowledgeDocumentCoverStates returns generation status without reading image bytes.
func ListKnowledgeDocumentCoverStates(baseId int) (map[string]string, error) {
	var rows []KnowledgeDocumentCover
	if err := DB.Select("document_id", "status").Where("knowledge_base_id = ?", baseId).Find(&rows).Error; err != nil {
		return nil, err
	}
	states := make(map[string]string, len(rows))
	for _, row := range rows {
		states[row.DocumentId] = row.Status
	}
	return states, nil
}

// DeleteKnowledgeDocumentCovers removes covers and cancels queued work for deleted documents.
func DeleteKnowledgeDocumentCovers(baseId int, documentIds []string) error {
	return DB.Where("knowledge_base_id = ? AND document_id IN ?", baseId, documentIds).Delete(&KnowledgeDocumentCover{}).Error
}
