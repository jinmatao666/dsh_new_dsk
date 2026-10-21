package model

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	KnowledgeBasePersonal   = "personal"
	KnowledgeBaseShared     = "shared"
	KnowledgeBaseCommon     = "common"
	KnowledgeGrantUser      = "user"
	KnowledgeGrantDept      = "department"
	KnowledgeShelfPublished = "published"
	KnowledgeShelfOffline   = "offline"
)

// KnowledgeBase binds an authorized OneAPI resource to one RAGFlow dataset.
type KnowledgeBase struct {
	Id               int       `json:"id" gorm:"primaryKey"`
	Name             string    `json:"name" gorm:"type:varchar(128);not null"`
	Description      string    `json:"description" gorm:"type:varchar(500)"`
	RagflowDatasetId string    `json:"-" gorm:"type:varchar(64);uniqueIndex;not null"`
	OwnerUserId      int       `json:"owner_user_id" gorm:"index;not null"`
	OrgId            int       `json:"org_id" gorm:"index;default:0"`
	Kind             string    `json:"kind" gorm:"type:varchar(16);index;not null"`
	Shelf            string    `json:"shelf" gorm:"type:varchar(16);not null;default:published;index"`
	Tags             string    `json:"tags" gorm:"type:varchar(200)"`
	CreatedAt        time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt        time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// KnowledgeBaseGrant gives one user or department access to a shared knowledge base.
type KnowledgeBaseGrant struct {
	Id              int       `json:"id" gorm:"primaryKey"`
	KnowledgeBaseId int       `json:"knowledge_base_id" gorm:"uniqueIndex:uk_knowledge_grant;index;not null"`
	SubjectType     string    `json:"subject_type" gorm:"uniqueIndex:uk_knowledge_grant;type:varchar(16);not null"`
	SubjectId       int       `json:"subject_id" gorm:"uniqueIndex:uk_knowledge_grant;not null"`
	CreatedAt       time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// KnowledgeDocumentNote stores the administrator-written summary for one RAGFlow document.
type KnowledgeDocumentNote struct {
	Id              int       `json:"id" gorm:"primaryKey"`
	KnowledgeBaseId int       `json:"knowledge_base_id" gorm:"uniqueIndex:uk_knowledge_document_note;not null"`
	DocumentId      string    `json:"document_id" gorm:"uniqueIndex:uk_knowledge_document_note;type:varchar(64);not null"`
	Summary         string    `json:"summary" gorm:"type:varchar(500)"`
	UpdatedAt       time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// KnowledgeDocumentPath keeps the relative folder path for one uploaded document.
// RAGFlow list responses often return only the base file name, so the desktop tree reads this table.
type KnowledgeDocumentPath struct {
	Id              int       `json:"id" gorm:"primaryKey"`
	KnowledgeBaseId int       `json:"knowledge_base_id" gorm:"uniqueIndex:uk_knowledge_document_path;not null"`
	DocumentId      string    `json:"document_id" gorm:"uniqueIndex:uk_knowledge_document_path;type:varchar(64);not null"`
	RelativePath    string    `json:"relative_path" gorm:"type:varchar(512);not null"`
	UpdatedAt       time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// KnowledgeConversation stores the isolated RAGFlow assistant and session for one user conversation.
type KnowledgeConversation struct {
	Id              int       `json:"id" gorm:"primaryKey"`
	UserId          int       `json:"user_id" gorm:"index;not null"`
	KnowledgeBaseId int       `json:"knowledge_base_id" gorm:"index;not null"`
	RagflowChatId   string    `json:"-" gorm:"type:varchar(64);uniqueIndex;not null"`
	RagflowSessionId string   `json:"-" gorm:"type:varchar(64);uniqueIndex;not null"`
	Model           string    `json:"model" gorm:"type:varchar(128)"`
	CreatedAt       time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt       time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// KnowledgeBaseListItem is one catalog row plus the owner's display name for the workbench.
type KnowledgeBaseListItem struct {
	KnowledgeBase
	OwnerUsername string `json:"owner_username"`
}

// ListAuthorizedKnowledgeBases returns published libraries the user may open:
// personal ones they own, shared ones they own or are granted, and every common library.
func ListAuthorizedKnowledgeBases(userId int) ([]KnowledgeBase, error) {
	var deptIds []int
	if err := DB.Model(&OrgMember{}).
		Where("user_id = ? AND status = ? AND dept_id <> 0", userId, OrgMemberStatusEnabled).
		Pluck("dept_id", &deptIds).Error; err != nil {
		return nil, err
	}
	// An empty shelf is the pre-migration published state.
	clause := `COALESCE(knowledge_bases.shelf, '') <> ? AND (` +
		`knowledge_bases.kind = ? OR ` +
		`(knowledge_bases.kind = ? AND knowledge_bases.owner_user_id = ?) OR ` +
		`(knowledge_bases.kind = ? AND (knowledge_bases.owner_user_id = ? OR ` +
		`(knowledge_base_grants.subject_type = ? AND knowledge_base_grants.subject_id = ?)`
	args := []interface{}{
		KnowledgeShelfOffline,
		KnowledgeBaseCommon,
		KnowledgeBasePersonal, userId,
		KnowledgeBaseShared, userId, KnowledgeGrantUser, userId,
	}
	if len(deptIds) != 0 {
		clause += ` OR (knowledge_base_grants.subject_type = ? AND knowledge_base_grants.subject_id IN ?)`
		args = append(args, KnowledgeGrantDept, deptIds)
	}
	// Close shared-inner, shared, and the outer authorization group.
	clause += `)))`
	var rows []KnowledgeBase
	err := DB.Model(&KnowledgeBase{}).Distinct("knowledge_bases.*").
		Joins("LEFT JOIN knowledge_base_grants ON knowledge_base_grants.knowledge_base_id = knowledge_bases.id").
		Where(clause, args...).
		Order("knowledge_bases.updated_at DESC").
		Find(&rows).Error
	return rows, err
}

// ListManagedKnowledgeBases returns every library for the workbench, including offline and common ones.
func ListManagedKnowledgeBases() ([]KnowledgeBaseListItem, error) {
	var bases []KnowledgeBase
	if err := DB.Order("updated_at DESC").Find(&bases).Error; err != nil {
		return nil, err
	}
	ownerIds := make([]int, 0, len(bases))
	seen := make(map[int]struct{}, len(bases))
	for _, base := range bases {
		if _, ok := seen[base.OwnerUserId]; ok {
			continue
		}
		seen[base.OwnerUserId] = struct{}{}
		ownerIds = append(ownerIds, base.OwnerUserId)
	}
	names := make(map[int]string, len(ownerIds))
	if len(ownerIds) != 0 {
		var users []User
		if err := DB.Select("id", "username", "display_name").Where("id IN ?", ownerIds).Find(&users).Error; err != nil {
			return nil, err
		}
		for _, user := range users {
			name := user.DisplayName
			if name == "" {
				name = user.Username
			}
			names[user.Id] = name
		}
	}
	rows := make([]KnowledgeBaseListItem, len(bases))
	for i, base := range bases {
		rows[i] = KnowledgeBaseListItem{KnowledgeBase: base, OwnerUsername: names[base.OwnerUserId]}
	}
	return rows, nil
}

// GetKnowledgeBase reads one library by its local id.
func GetKnowledgeBase(id int) (*KnowledgeBase, error) {
	var row KnowledgeBase
	err := DB.First(&row, id).Error
	return &row, err
}

// SaveKnowledgeDocumentSummary inserts or replaces the summary shown in the workbench file list.
func SaveKnowledgeDocumentSummary(baseId int, documentId, summary string) error {
	var note KnowledgeDocumentNote
	err := DB.Where("knowledge_base_id = ? AND document_id = ?", baseId, documentId).First(&note).Error
	if err == gorm.ErrRecordNotFound {
		return DB.Create(&KnowledgeDocumentNote{KnowledgeBaseId: baseId, DocumentId: documentId, Summary: summary}).Error
	}
	if err != nil {
		return err
	}
	return DB.Model(&note).Update("summary", summary).Error
}

// ListKnowledgeDocumentSummaries returns summaries keyed by RAGFlow document id.
func ListKnowledgeDocumentSummaries(baseId int) (map[string]string, error) {
	var notes []KnowledgeDocumentNote
	if err := DB.Where("knowledge_base_id = ?", baseId).Find(&notes).Error; err != nil {
		return nil, err
	}
	summaries := make(map[string]string, len(notes))
	for _, note := range notes {
		summaries[note.DocumentId] = note.Summary
	}
	return summaries, nil
}

// SaveKnowledgeDocumentPath inserts or replaces the relative path used by the desktop folder tree.
func SaveKnowledgeDocumentPath(baseId int, documentId, relativePath string) error {
	relativePath = strings.TrimSpace(strings.ReplaceAll(relativePath, "\\", "/"))
	relativePath = strings.Trim(relativePath, "/")
	if baseId <= 0 || documentId == "" || relativePath == "" {
		return nil
	}
	var row KnowledgeDocumentPath
	err := DB.Where("knowledge_base_id = ? AND document_id = ?", baseId, documentId).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		return DB.Create(&KnowledgeDocumentPath{
			KnowledgeBaseId: baseId,
			DocumentId:      documentId,
			RelativePath:    relativePath,
		}).Error
	}
	if err != nil {
		return err
	}
	return DB.Model(&row).Update("relative_path", relativePath).Error
}

// ListKnowledgeDocumentPaths returns relative paths keyed by RAGFlow document id.
func ListKnowledgeDocumentPaths(baseId int) (map[string]string, error) {
	var rows []KnowledgeDocumentPath
	if err := DB.Where("knowledge_base_id = ?", baseId).Find(&rows).Error; err != nil {
		return nil, err
	}
	paths := make(map[string]string, len(rows))
	for _, row := range rows {
		paths[row.DocumentId] = row.RelativePath
	}
	return paths, nil
}

// DeleteKnowledgeDocumentPath removes one stored relative path.
func DeleteKnowledgeDocumentPath(baseId int, documentId string) error {
	return DB.Where("knowledge_base_id = ? AND document_id = ?", baseId, documentId).
		Delete(&KnowledgeDocumentPath{}).Error
}

// DeleteKnowledgeBaseRecords removes the local library and its grants, conversations, and summaries.
func DeleteKnowledgeBaseRecords(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("knowledge_base_id = ?", id).Delete(&KnowledgeBaseGrant{}).Error; err != nil {
			return err
		}
		if err := tx.Where("knowledge_base_id = ?", id).Delete(&KnowledgeConversation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("knowledge_base_id = ?", id).Delete(&KnowledgeDocumentNote{}).Error; err != nil {
			return err
		}
		if err := tx.Where("knowledge_base_id = ?", id).Delete(&KnowledgeDocumentPath{}).Error; err != nil {
			return err
		}
		return tx.Delete(&KnowledgeBase{}, id).Error
	})
}

// GetAuthorizedKnowledgeBase fails closed when the user has no grant.
// Administrators may open any library, including offline and another user's personal one.
func GetAuthorizedKnowledgeBase(userId, id int, admin bool) (*KnowledgeBase, error) {
	if admin {
		return GetKnowledgeBase(id)
	}
	rows, err := ListAuthorizedKnowledgeBases(userId)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].Id == id {
			return &rows[i], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}
