package model

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

const (
	KnowledgeBasePersonal             = "personal"
	KnowledgeBaseShared               = "shared"
	KnowledgeBaseCommon               = "common"
	KnowledgeGrantUser                = "user"
	KnowledgeGrantDept                = "department"
	KnowledgeShelfPublished           = "published"
	KnowledgeShelfOffline             = "offline"
	KnowledgeSubscriptionPending      = "pending"
	KnowledgeSubscriptionApproved     = "approved"
	KnowledgeSubscriptionRejected     = "rejected"
	KnowledgeSubscriptionStatusNone   = "none"
	// KnowledgeSubscriptionStatusOwned is retained for older clients; plaza no longer returns owned rows.
	KnowledgeSubscriptionStatusOwned = "owned"
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
	CategoryId       int       `json:"category_id" gorm:"index;default:0"`
	// VisitCount is the lifetime number of authorized opens/uses (documents, chat, retrieval).
	VisitCount int64 `json:"visit_count" gorm:"not null;default:0"`
	// DailyUsage is the number of authorized opens/uses on DailyUsageDate (server local calendar day).
	DailyUsage     int64  `json:"daily_usage" gorm:"not null;default:0"`
	DailyUsageDate string `json:"-" gorm:"type:varchar(10);not null;default:''"`
	CreatedAt      time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// ErrKnowledgeCategoryDuplicate is returned when a category name is already stored.
var ErrKnowledgeCategoryDuplicate = errors.New("知识库分类名称已存在")

// ErrKnowledgeCategoryInvalid is returned when the name or type cannot be stored.
var ErrKnowledgeCategoryInvalid = errors.New("知识库分类无效")

// KnowledgeCategory is an administrator-defined tab beside Personal on the workbench and desktop.
// Type is the library kind created inside the tab. Only common categories with RequireAuth false
// are open to every signed-in user; personal and shared categories always use owner-or-grant.
type KnowledgeCategory struct {
	Id          int       `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"type:varchar(64);uniqueIndex;not null"`
	Type        string    `json:"type" gorm:"type:varchar(16);not null"`
	RequireAuth bool      `json:"require_auth" gorm:"not null;default:false"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// KnowledgeBaseGrant gives one user or department access to a shared knowledge base.
type KnowledgeBaseGrant struct {
	Id              int       `json:"id" gorm:"primaryKey"`
	KnowledgeBaseId int       `json:"knowledge_base_id" gorm:"uniqueIndex:uk_knowledge_grant;index;not null"`
	SubjectType     string    `json:"subject_type" gorm:"uniqueIndex:uk_knowledge_grant;type:varchar(16);not null"`
	SubjectId       int       `json:"subject_id" gorm:"uniqueIndex:uk_knowledge_grant;not null"`
	CreatedAt       time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// KnowledgeSubscriptionApplication is one user's request to subscribe to an auth-required category library.
// Approval writes a user grant so the library appears under Subscription on the desktop.
type KnowledgeSubscriptionApplication struct {
	Id              int        `json:"id" gorm:"primaryKey"`
	KnowledgeBaseId int        `json:"knowledge_base_id" gorm:"uniqueIndex:uk_knowledge_subscription;index;not null"`
	ApplicantUserId int        `json:"applicant_user_id" gorm:"uniqueIndex:uk_knowledge_subscription;index;not null"`
	Status          string     `json:"status" gorm:"type:varchar(16);index;not null"`
	ReviewedBy      int        `json:"reviewed_by" gorm:"default:0"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
	CreatedAt       time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt       time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

// KnowledgePlazaItem is one marketplace card for libraries in auth-required categories.
type KnowledgePlazaItem struct {
	KnowledgeBase
	CategoryName       string `json:"category_name"`
	OwnerUsername      string `json:"owner_username"`
	SubscriptionStatus string `json:"subscription_status"`
}

// KnowledgeSubscriptionApplicationItem is one workbench audit row.
type KnowledgeSubscriptionApplicationItem struct {
	KnowledgeSubscriptionApplication
	KnowledgeBaseName string `json:"knowledge_base_name"`
	CategoryName      string `json:"category_name"`
	ApplicantUsername string `json:"applicant_username"`
	OwnerUsername     string `json:"owner_username"`
}

// ErrKnowledgeSubscriptionInvalid is returned when a library cannot accept a subscription.
var ErrKnowledgeSubscriptionInvalid = errors.New("该知识库不支持订阅申请")

// ErrKnowledgeSubscriptionDuplicate is returned when a pending or approved application already exists.
var ErrKnowledgeSubscriptionDuplicate = errors.New("订阅申请已存在")

// ErrKnowledgeSubscriptionNotPending is returned when an application is no longer awaiting review.
var ErrKnowledgeSubscriptionNotPending = errors.New("订阅申请已处理")

// ErrKnowledgeSubscriptionInactive is returned when the caller has no grant or application to cancel.
var ErrKnowledgeSubscriptionInactive = errors.New("当前未订阅该知识库")

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

// knowledgeViewerDeptIds returns enabled department ids for the caller.
func knowledgeViewerDeptIds(userId int) ([]int, error) {
	var deptIds []int
	err := DB.Model(&OrgMember{}).
		Where("user_id = ? AND status = ? AND dept_id <> 0", userId, OrgMemberStatusEnabled).
		Pluck("dept_id", &deptIds).Error
	return deptIds, err
}

// KnowledgeBaseGrantIDs returns knowledge_base ids where the caller holds a user or department grant.
// Ownership alone does not count; desktop 订阅知识库 uses this set.
func KnowledgeBaseGrantIDs(userId int) (map[int]struct{}, error) {
	deptIds, err := knowledgeViewerDeptIds(userId)
	if err != nil {
		return nil, err
	}
	query := DB.Model(&KnowledgeBaseGrant{}).Select("knowledge_base_id").
		Where("subject_type = ? AND subject_id = ?", KnowledgeGrantUser, userId)
	if len(deptIds) != 0 {
		query = query.Or("subject_type = ? AND subject_id IN ?", KnowledgeGrantDept, deptIds)
	}
	var ids []int
	if err := query.Distinct("knowledge_base_id").Pluck("knowledge_base_id", &ids).Error; err != nil {
		return nil, err
	}
	out := make(map[int]struct{}, len(ids))
	for _, id := range ids {
		out[id] = struct{}{}
	}
	return out, nil
}

// ListUncategorizedPersonalKnowledgeBases returns every published personal library
// that is not filed under a workbench category (desktop 个人知识库 for administrators).
func ListUncategorizedPersonalKnowledgeBases() ([]KnowledgeBase, error) {
	var rows []KnowledgeBase
	err := DB.Where("kind = ? AND COALESCE(category_id, 0) = 0 AND COALESCE(shelf, '') <> ?",
		KnowledgeBasePersonal, KnowledgeShelfOffline).
		Order("updated_at DESC").Find(&rows).Error
	return rows, err
}

// MergeAdminPersonalKnowledgeBases appends every uncategorized personal library missing
// from an authorized desktop list so administrators can open other users' personal libraries.
func MergeAdminPersonalKnowledgeBases(rows []KnowledgeBase) ([]KnowledgeBase, error) {
	personal, err := ListUncategorizedPersonalKnowledgeBases()
	if err != nil {
		return nil, err
	}
	seen := make(map[int]struct{}, len(rows))
	for _, row := range rows {
		seen[row.Id] = struct{}{}
	}
	for _, row := range personal {
		if _, ok := seen[row.Id]; ok {
			continue
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// ListAuthorizedKnowledgeBases returns published libraries the user may open.
// Uncategorized personal libraries stay with their owner, uncategorized shared libraries
// require ownership or a grant, and every uncategorized common library is included.
// A library in a workbench category is open to everyone only when that category is common
// and does not require auth; otherwise only the owner or a grant holder may open it.
// Personal-type categories never become world-readable via a stale require_auth=false row.
func ListAuthorizedKnowledgeBases(userId int) ([]KnowledgeBase, error) {
	deptIds, err := knowledgeViewerDeptIds(userId)
	if err != nil {
		return nil, err
	}
	// An empty shelf is the pre-migration published state.
	grant := `(knowledge_base_grants.subject_type = ? AND knowledge_base_grants.subject_id = ?)`
	grantArgs := []interface{}{KnowledgeGrantUser, userId}
	if len(deptIds) != 0 {
		grant += ` OR (knowledge_base_grants.subject_type = ? AND knowledge_base_grants.subject_id IN ?)`
		grantArgs = append(grantArgs, KnowledgeGrantDept, deptIds)
	}
	clause := `COALESCE(knowledge_bases.shelf, '') <> ? AND (` +
		`(COALESCE(knowledge_bases.category_id, 0) = 0 AND (` +
		`knowledge_bases.kind = ? OR ` +
		`(knowledge_bases.kind = ? AND knowledge_bases.owner_user_id = ?) OR ` +
		`(knowledge_bases.kind = ? AND (knowledge_bases.owner_user_id = ? OR ` + grant + `)))) OR ` +
		`(COALESCE(knowledge_bases.category_id, 0) <> 0 AND knowledge_categories.id IS NOT NULL AND (` +
		`(knowledge_categories.type = ? AND knowledge_categories.require_auth = ?) OR ` +
		`knowledge_bases.owner_user_id = ? OR ` + grant + `)))`
	args := []interface{}{
		KnowledgeShelfOffline,
		KnowledgeBaseCommon,
		KnowledgeBasePersonal, userId,
		KnowledgeBaseShared, userId,
	}
	args = append(args, grantArgs...)
	args = append(args, KnowledgeBaseCommon, false, userId)
	args = append(args, grantArgs...)
	var rows []KnowledgeBase
	err = DB.Model(&KnowledgeBase{}).Distinct("knowledge_bases.*").
		Joins("LEFT JOIN knowledge_base_grants ON knowledge_base_grants.knowledge_base_id = knowledge_bases.id").
		Joins("LEFT JOIN knowledge_categories ON knowledge_categories.id = knowledge_bases.category_id").
		Where(clause, args...).
		Order("knowledge_bases.updated_at DESC").
		Find(&rows).Error
	return rows, err
}

// ListKnowledgeCategories returns workbench categories in creation order.
func ListKnowledgeCategories() ([]KnowledgeCategory, error) {
	var rows []KnowledgeCategory
	err := DB.Order("id ASC").Find(&rows).Error
	return rows, err
}

// GetKnowledgeCategory reads one category by its local id.
func GetKnowledgeCategory(id int) (*KnowledgeCategory, error) {
	var row KnowledgeCategory
	err := DB.First(&row, id).Error
	return &row, err
}

func normalizeKnowledgeCategory(row *KnowledgeCategory) error {
	row.Name = strings.TrimSpace(row.Name)
	row.Type = strings.TrimSpace(row.Type)
	if row.Name == "" || utf8.RuneCountInString(row.Name) > 64 ||
		(row.Type != KnowledgeBasePersonal && row.Type != KnowledgeBaseShared && row.Type != KnowledgeBaseCommon) {
		return ErrKnowledgeCategoryInvalid
	}
	// Visibility is named by type: 个人/授权 always require auth; 公开 never does.
	row.RequireAuth = row.Type != KnowledgeBaseCommon
	return nil
}

// SaveKnowledgeCategory inserts one category. Names are unique after trimming.
func SaveKnowledgeCategory(row *KnowledgeCategory) error {
	if err := normalizeKnowledgeCategory(row); err != nil {
		return err
	}
	var count int64
	if err := DB.Model(&KnowledgeCategory{}).Where("name = ?", row.Name).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrKnowledgeCategoryDuplicate
	}
	return DB.Create(row).Error
}

// UpdateKnowledgeCategory saves name, type, and require_auth for an existing category.
func UpdateKnowledgeCategory(row *KnowledgeCategory) error {
	if row.Id <= 0 {
		return ErrKnowledgeCategoryInvalid
	}
	if err := normalizeKnowledgeCategory(row); err != nil {
		return err
	}
	var count int64
	if err := DB.Model(&KnowledgeCategory{}).Where("name = ? AND id <> ?", row.Name, row.Id).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrKnowledgeCategoryDuplicate
	}
	result := DB.Model(&KnowledgeCategory{}).Where("id = ?", row.Id).Updates(map[string]interface{}{
		"name":         row.Name,
		"type":         row.Type,
		"require_auth": row.RequireAuth,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return DB.First(row, row.Id).Error
}

// ListKnowledgeBasesByCategory returns every library filed under one workbench category.
func ListKnowledgeBasesByCategory(categoryId int) ([]KnowledgeBase, error) {
	if categoryId <= 0 {
		return nil, ErrKnowledgeCategoryInvalid
	}
	var rows []KnowledgeBase
	err := DB.Where("category_id = ?", categoryId).Order("id ASC").Find(&rows).Error
	return rows, err
}

// DeleteKnowledgeCategory removes one category row. Callers must remove filed libraries first.
func DeleteKnowledgeCategory(id int) error {
	if id <= 0 {
		return ErrKnowledgeCategoryInvalid
	}
	result := DB.Delete(&KnowledgeCategory{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// knowledgeUsageDay is the server-local calendar day used for DailyUsage buckets.
func knowledgeUsageDay(now time.Time) string {
	return now.Format("2006-01-02")
}

// RecordKnowledgeBaseUsage increments lifetime visit_count and today's daily_usage.
// A new local calendar day resets daily_usage to 1.
// @param id - Local knowledge_bases.id.
// @returns Database error when the library is missing or the update fails.
func RecordKnowledgeBaseUsage(id int) error {
	if id <= 0 {
		return gorm.ErrRecordNotFound
	}
	today := knowledgeUsageDay(time.Now())
	return DB.Transaction(func(tx *gorm.DB) error {
		var row KnowledgeBase
		if err := tx.Select("id", "visit_count", "daily_usage", "daily_usage_date").First(&row, id).Error; err != nil {
			return err
		}
		daily := int64(1)
		if row.DailyUsageDate == today {
			daily = row.DailyUsage + 1
		}
		return tx.Model(&KnowledgeBase{}).Where("id = ?", id).Updates(map[string]interface{}{
			"visit_count":      gorm.Expr("visit_count + 1"),
			"daily_usage":      daily,
			"daily_usage_date": today,
		}).Error
	})
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
		if err := tx.Where("knowledge_base_id = ?", id).Delete(&KnowledgeSubscriptionApplication{}).Error; err != nil {
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

func userDisplayNames(userIds []int) (map[int]string, error) {
	names := make(map[int]string, len(userIds))
	if len(userIds) == 0 {
		return names, nil
	}
	var users []User
	if err := DB.Select("id", "username", "display_name").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, user := range users {
		name := user.DisplayName
		if name == "" {
			name = user.Username
		}
		names[user.Id] = name
	}
	return names, nil
}

// ListKnowledgePlaza returns published libraries in categories that require authorization.
// The caller's own libraries and approved grants omit their cards — those live under 订阅知识库.
// Callers without a grant still see others' cards so they can apply; subscription_status is none or pending.
func ListKnowledgePlaza(userId int, categoryId int, keyword string) ([]KnowledgePlazaItem, error) {
	// Personal categories are owner-only and never listed for subscription.
	query := DB.Model(&KnowledgeBase{}).
		Joins("INNER JOIN knowledge_categories ON knowledge_categories.id = knowledge_bases.category_id").
		Where("knowledge_categories.require_auth = ? AND knowledge_categories.type <> ? AND COALESCE(knowledge_bases.shelf, '') <> ?",
			true, KnowledgeBasePersonal, KnowledgeShelfOffline)
	if categoryId > 0 {
		query = query.Where("knowledge_bases.category_id = ?", categoryId)
	}
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("knowledge_bases.name LIKE ? OR knowledge_bases.description LIKE ?", like, like)
	}
	var bases []KnowledgeBase
	if err := query.Order("knowledge_bases.updated_at DESC").Find(&bases).Error; err != nil {
		return nil, err
	}
	if len(bases) == 0 {
		return []KnowledgePlazaItem{}, nil
	}
	categoryIds := make([]int, 0, len(bases))
	ownerIds := make([]int, 0, len(bases))
	baseIds := make([]int, 0, len(bases))
	seenCategory := map[int]struct{}{}
	seenOwner := map[int]struct{}{}
	for _, base := range bases {
		baseIds = append(baseIds, base.Id)
		if _, ok := seenCategory[base.CategoryId]; !ok {
			seenCategory[base.CategoryId] = struct{}{}
			categoryIds = append(categoryIds, base.CategoryId)
		}
		if _, ok := seenOwner[base.OwnerUserId]; !ok {
			seenOwner[base.OwnerUserId] = struct{}{}
			ownerIds = append(ownerIds, base.OwnerUserId)
		}
	}
	categories := map[int]string{}
	if len(categoryIds) != 0 {
		var rows []KnowledgeCategory
		if err := DB.Where("id IN ?", categoryIds).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			categories[row.Id] = row.Name
		}
	}
	owners, err := userDisplayNames(ownerIds)
	if err != nil {
		return nil, err
	}
	statusByBase := map[int]string{}
	var apps []KnowledgeSubscriptionApplication
	if err := DB.Where("applicant_user_id = ? AND knowledge_base_id IN ?", userId, baseIds).Find(&apps).Error; err != nil {
		return nil, err
	}
	for _, app := range apps {
		if app.Status == KnowledgeSubscriptionPending || app.Status == KnowledgeSubscriptionApproved {
			statusByBase[app.KnowledgeBaseId] = app.Status
		}
	}
	granted, err := KnowledgeBaseGrantIDs(userId)
	if err != nil {
		return nil, err
	}
	for _, id := range baseIds {
		if _, ok := granted[id]; ok {
			statusByBase[id] = KnowledgeSubscriptionApproved
		}
	}
	items := make([]KnowledgePlazaItem, 0, len(bases))
	for _, base := range bases {
		status := statusByBase[base.Id]
		if base.OwnerUserId == userId {
			// Owners open self-built auth libraries from 订阅知识库, not the plaza.
			continue
		}
		if status == "" {
			status = KnowledgeSubscriptionStatusNone
		}
		if status == KnowledgeSubscriptionApproved {
			continue
		}
		items = append(items, KnowledgePlazaItem{
			KnowledgeBase:      base,
			CategoryName:       categories[base.CategoryId],
			OwnerUsername:      owners[base.OwnerUserId],
			SubscriptionStatus: status,
		})
	}
	return items, nil
}

// GetKnowledgePlazaItem reads one marketplace library when it sits in an auth-required published category.
func GetKnowledgePlazaItem(userId, id int) (*KnowledgePlazaItem, error) {
	items, err := ListKnowledgePlaza(userId, 0, "")
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].Id == id {
			return &items[i], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

// CancelKnowledgeSubscription removes the caller's user grant and clears a pending or approved
// application so the library returns to the plaza for a fresh subscribe.
func CancelKnowledgeSubscription(userId, knowledgeBaseId int) error {
	base, err := GetKnowledgeBase(knowledgeBaseId)
	if err != nil {
		return err
	}
	if base.CategoryId == 0 || base.Shelf == KnowledgeShelfOffline {
		return ErrKnowledgeSubscriptionInvalid
	}
	category, err := GetKnowledgeCategory(base.CategoryId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrKnowledgeSubscriptionInvalid
		}
		return err
	}
	if !category.RequireAuth {
		return ErrKnowledgeSubscriptionInvalid
	}
	if base.OwnerUserId == userId {
		return ErrKnowledgeSubscriptionInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("knowledge_base_id = ? AND subject_type = ? AND subject_id = ?",
			knowledgeBaseId, KnowledgeGrantUser, userId).Delete(&KnowledgeBaseGrant{})
		if result.Error != nil {
			return result.Error
		}
		cleared := result.RowsAffected > 0
		var app KnowledgeSubscriptionApplication
		err := tx.Where("knowledge_base_id = ? AND applicant_user_id = ?", knowledgeBaseId, userId).First(&app).Error
		if err == nil {
			if app.Status == KnowledgeSubscriptionApproved || app.Status == KnowledgeSubscriptionPending {
				now := time.Now()
				if err := tx.Model(&app).Updates(map[string]interface{}{
					"status":      KnowledgeSubscriptionRejected,
					"reviewed_by": 0,
					"reviewed_at": now,
				}).Error; err != nil {
					return err
				}
				cleared = true
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if !cleared {
			return ErrKnowledgeSubscriptionInactive
		}
		return nil
	})
}

// ApplyKnowledgeSubscription creates or reopens a pending application for an auth-required category library.
func ApplyKnowledgeSubscription(userId, knowledgeBaseId int) (*KnowledgeSubscriptionApplication, error) {
	base, err := GetKnowledgeBase(knowledgeBaseId)
	if err != nil {
		return nil, err
	}
	if base.CategoryId == 0 || base.Shelf == KnowledgeShelfOffline {
		return nil, ErrKnowledgeSubscriptionInvalid
	}
	category, err := GetKnowledgeCategory(base.CategoryId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrKnowledgeSubscriptionInvalid
		}
		return nil, err
	}
	if !category.RequireAuth {
		return nil, ErrKnowledgeSubscriptionInvalid
	}
	if base.OwnerUserId == userId {
		return nil, ErrKnowledgeSubscriptionDuplicate
	}
	var grantCount int64
	if err := DB.Model(&KnowledgeBaseGrant{}).
		Where("knowledge_base_id = ? AND subject_type = ? AND subject_id = ?",
			knowledgeBaseId, KnowledgeGrantUser, userId).
		Count(&grantCount).Error; err != nil {
		return nil, err
	}
	if grantCount > 0 {
		return nil, ErrKnowledgeSubscriptionDuplicate
	}
	var existing KnowledgeSubscriptionApplication
	err = DB.Where("knowledge_base_id = ? AND applicant_user_id = ?", knowledgeBaseId, userId).First(&existing).Error
	if err == nil {
		if existing.Status == KnowledgeSubscriptionPending || existing.Status == KnowledgeSubscriptionApproved {
			return nil, ErrKnowledgeSubscriptionDuplicate
		}
		existing.Status = KnowledgeSubscriptionPending
		existing.ReviewedBy = 0
		existing.ReviewedAt = nil
		if err := DB.Save(&existing).Error; err != nil {
			return nil, err
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	row := KnowledgeSubscriptionApplication{
		KnowledgeBaseId: knowledgeBaseId,
		ApplicantUserId: userId,
		Status:          KnowledgeSubscriptionPending,
	}
	if err := DB.Create(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// ListKnowledgeSubscriptionApplications returns a page of applications for the workbench audit list.
func ListKnowledgeSubscriptionApplications(status string, page, pageSize int) ([]KnowledgeSubscriptionApplicationItem, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	query := DB.Model(&KnowledgeSubscriptionApplication{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var apps []KnowledgeSubscriptionApplication
	if err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&apps).Error; err != nil {
		return nil, 0, err
	}
	if len(apps) == 0 {
		return []KnowledgeSubscriptionApplicationItem{}, total, nil
	}
	baseIds := make([]int, 0, len(apps))
	userIds := make([]int, 0, len(apps)*2)
	seenBase := map[int]struct{}{}
	seenUser := map[int]struct{}{}
	for _, app := range apps {
		if _, ok := seenBase[app.KnowledgeBaseId]; !ok {
			seenBase[app.KnowledgeBaseId] = struct{}{}
			baseIds = append(baseIds, app.KnowledgeBaseId)
		}
		if _, ok := seenUser[app.ApplicantUserId]; !ok {
			seenUser[app.ApplicantUserId] = struct{}{}
			userIds = append(userIds, app.ApplicantUserId)
		}
	}
	var bases []KnowledgeBase
	if err := DB.Where("id IN ?", baseIds).Find(&bases).Error; err != nil {
		return nil, 0, err
	}
	baseById := map[int]KnowledgeBase{}
	categoryIds := make([]int, 0, len(bases))
	seenCategory := map[int]struct{}{}
	for _, base := range bases {
		baseById[base.Id] = base
		if _, ok := seenUser[base.OwnerUserId]; !ok {
			seenUser[base.OwnerUserId] = struct{}{}
			userIds = append(userIds, base.OwnerUserId)
		}
		if base.CategoryId > 0 {
			if _, ok := seenCategory[base.CategoryId]; !ok {
				seenCategory[base.CategoryId] = struct{}{}
				categoryIds = append(categoryIds, base.CategoryId)
			}
		}
	}
	names, err := userDisplayNames(userIds)
	if err != nil {
		return nil, 0, err
	}
	categories := map[int]string{}
	if len(categoryIds) != 0 {
		var rows []KnowledgeCategory
		if err := DB.Where("id IN ?", categoryIds).Find(&rows).Error; err != nil {
			return nil, 0, err
		}
		for _, row := range rows {
			categories[row.Id] = row.Name
		}
	}
	items := make([]KnowledgeSubscriptionApplicationItem, len(apps))
	for i, app := range apps {
		base := baseById[app.KnowledgeBaseId]
		items[i] = KnowledgeSubscriptionApplicationItem{
			KnowledgeSubscriptionApplication: app,
			KnowledgeBaseName:                base.Name,
			CategoryName:                     categories[base.CategoryId],
			ApplicantUsername:                names[app.ApplicantUserId],
			OwnerUsername:                    names[base.OwnerUserId],
		}
	}
	return items, total, nil
}

// ReviewKnowledgeSubscription approves or rejects one pending application.
// Approval inserts a user grant so ListAuthorizedKnowledgeBases includes the library.
func ReviewKnowledgeSubscription(applicationId, reviewerId int, approve bool) (*KnowledgeSubscriptionApplication, error) {
	var app KnowledgeSubscriptionApplication
	if err := DB.First(&app, applicationId).Error; err != nil {
		return nil, err
	}
	if app.Status != KnowledgeSubscriptionPending {
		return nil, ErrKnowledgeSubscriptionNotPending
	}
	now := time.Now()
	err := DB.Transaction(func(tx *gorm.DB) error {
		status := KnowledgeSubscriptionRejected
		if approve {
			status = KnowledgeSubscriptionApproved
			var count int64
			if err := tx.Model(&KnowledgeBaseGrant{}).
				Where("knowledge_base_id = ? AND subject_type = ? AND subject_id = ?",
					app.KnowledgeBaseId, KnowledgeGrantUser, app.ApplicantUserId).
				Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				if err := tx.Create(&KnowledgeBaseGrant{
					KnowledgeBaseId: app.KnowledgeBaseId,
					SubjectType:     KnowledgeGrantUser,
					SubjectId:       app.ApplicantUserId,
				}).Error; err != nil {
					return err
				}
			}
		}
		return tx.Model(&app).Updates(map[string]interface{}{
			"status":      status,
			"reviewed_by": reviewerId,
			"reviewed_at": now,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	if err := DB.First(&app, applicationId).Error; err != nil {
		return nil, err
	}
	return &app, nil
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
