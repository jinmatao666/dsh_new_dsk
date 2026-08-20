package model

import (
	"encoding/json"
	"strings"
	"sync"

	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
)

type Skill struct {
	Id              int             `json:"id" gorm:"primaryKey;autoIncrement"`
	Name            string          `json:"name" gorm:"uniqueIndex;size:100;not null"`
	DisplayName     string          `json:"display_name" gorm:"size:100;default:''"`
	Category        string          `json:"category" gorm:"size:255;default:''"` // 分类,如 doc-processing / dev-tool
	Description     string          `json:"description" gorm:"size:500;default:''"`
	Scenario        string          `json:"scenario" gorm:"size:500;default:''"`
	Content         string          `json:"content" gorm:"type:text;not null"`
	Body            string          `json:"body" gorm:"type:text"`
	Assets          string          `json:"assets" gorm:"type:text"`
	Submitter       string          `json:"submitter" gorm:"size:100;default:''"`
	Tags            json.RawMessage `json:"tags" gorm:"type:json"`
	Downloads       int             `json:"downloads" gorm:"default:0"`
	Version         string          `json:"version" gorm:"size:50;default:'1.0'"`
	Status          int             `json:"status" gorm:"default:1"`                       // 历史字段,保留但不再暴露
	IsDeleted       bool            `json:"is_deleted" gorm:"column:is_deleted;default:0"` // 软删除生命周期
	CreatedAt       int64           `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt       int64           `json:"updated_at" gorm:"autoUpdateTime"`
	BodyUpdatedAt   int64           `json:"body_updated_at" gorm:"default:0"`
	AssetsUpdatedAt int64           `json:"assets_updated_at" gorm:"default:0"`
}

// EffectiveBody returns the body text used for LLM injection.
// When Body is non-empty it is preferred; otherwise we fall back to legacy
// Content so skills that have not been migrated still work.
func (s *Skill) EffectiveBody() string {
	if s.Body != "" {
		return s.Body
	}
	return s.Content
}

var (
	skillCache     map[string]*Skill
	skillCacheLock sync.RWMutex
)

func InitSkillCache() error {
	var skills []Skill
	// 只装入未软删的 skill;status 暂时保留过滤以兼容历史禁用数据
	err := DB.Where("is_deleted = ? AND status = ?", false, 1).Find(&skills).Error
	if err != nil {
		return err
	}
	cache := make(map[string]*Skill, len(skills))
	for i := range skills {
		cache[skills[i].Name] = &skills[i]
	}
	skillCacheLock.Lock()
	skillCache = cache
	skillCacheLock.Unlock()
	logger.SysLogf("loaded %d skills into cache", len(cache))
	return nil
}

func GetSkillByName(name string) *Skill {
	skillCacheLock.RLock()
	defer skillCacheLock.RUnlock()
	if skillCache == nil {
		return nil
	}
	return skillCache[name]
}

// GetSkillContentByName checks the official skill cache first,
// then falls back to personal_skills table for the given owner.
// Returns the effective body (Body if migrated, else legacy Content).
func GetSkillContentByName(name string, owner string) string {
	s := GetSkillByName(name)
	if s != nil {
		return s.EffectiveBody()
	}
	if owner == "" {
		return ""
	}
	var ps PersonalSkill
	err := DB.Where("name = ? AND owner = ?", name, owner).First(&ps).Error
	if err != nil {
		return ""
	}
	return ps.EffectiveBody()
}

// GetPersonalSkillContent queries personal_skills by name and owner and
// returns the effective body for injection.
func GetPersonalSkillContent(name string, owner string) string {
	if owner == "" {
		return ""
	}
	var ps PersonalSkill
	err := DB.Where("name = ? AND owner = ?", name, owner).First(&ps).Error
	if err != nil {
		return ""
	}
	return ps.EffectiveBody()
}

// GetPersonalSkillForInjection returns the full PersonalSkill record so the
// injection middleware can also inspect Assets/BodyUpdatedAt without a second
// trip. Returns nil when not found or owner missing.
func GetPersonalSkillForInjection(name string, owner string) *PersonalSkill {
	if owner == "" {
		return nil
	}
	var ps PersonalSkill
	err := DB.Where("name = ? AND owner = ?", name, owner).First(&ps).Error
	if err != nil {
		return nil
	}
	return &ps
}

func RefreshSkillCache() error {
	return InitSkillCache()
}

func GetAllSkillMeta() []Skill {
	skillCacheLock.RLock()
	defer skillCacheLock.RUnlock()
	if skillCache == nil {
		return nil
	}
	result := make([]Skill, 0, len(skillCache))
	for _, s := range skillCache {
		result = append(result, Skill{
			Id:              s.Id,
			Name:            s.Name,
			DisplayName:     s.DisplayName,
			Category:        s.Category,
			Description:     s.Description,
			Scenario:        s.Scenario,
			Submitter:       s.Submitter,
			Tags:            s.Tags,
			Downloads:       s.Downloads,
			Version:         s.Version,
			Status:          s.Status,
			IsDeleted:       s.IsDeleted,
			CreatedAt:       s.CreatedAt,
			UpdatedAt:       s.UpdatedAt,
			BodyUpdatedAt:   s.BodyUpdatedAt,
			AssetsUpdatedAt: s.AssetsUpdatedAt,
		})
	}
	return result
}

func GetSkillById(id int) (*Skill, error) {
	var skill Skill
	err := DB.First(&skill, id).Error
	if err != nil {
		return nil, err
	}
	return &skill, nil
}

// GetVisibleSkillById 只返回"公开可见"（status==1 且未软删）的 skill，
// 供 bundle 等面向普通登录用户的接口使用。与 GetSkillById 刻意区分：后者不加
// 过滤，供 admin 路径（AdminGetSkillFull 等）读取被禁用/软删的记录。口径与
// ListSkills / InitSkillCache 一致，未命中返回 gorm.ErrRecordNotFound。
func GetVisibleSkillById(id int) (*Skill, error) {
	var skill Skill
	err := DB.Where("id = ? AND status = ? AND is_deleted = ?", id, 1, false).First(&skill).Error
	if err != nil {
		return nil, err
	}
	return &skill, nil
}

// GetSkillDisplayNamesByIds 按 id 批量查 display_name，用于客户端清理已下架/移出包技能后
// 反查中文名展示。刻意不过滤 is_deleted/status —— 这些技能多半已被软删/禁用，
// 不在 skillCache（GetAllSkillMeta）中，必须直接查表才能拿到中文名。
func GetSkillDisplayNamesByIds(ids []int) (map[int]string, error) {
	result := make(map[int]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var rows []Skill
	err := DB.Model(&Skill{}).
		Select("skills.id, skills.name, skills.display_name").
		Where("skills.id IN ?", ids).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, s := range rows {
		name := strings.TrimSpace(s.DisplayName)
		if name == "" {
			name = s.Name
		}
		result[s.Id] = name
	}
	return result, nil
}

// SearchSkills 公开/管理列表查询。
// category: 空字符串表示不筛选。保留旧签名,内部走 legacy category 过滤。
// includeDisabled: 为 true 时包含 status=0 的禁用记录(historical flag,保留兼容)
// includeDeleted:  为 true 时包含 is_deleted=1 的软删记录;默认过滤软删
func SearchSkills(keyword, category string, page, perPage int, includeDisabled, includeDeleted bool) ([]Skill, int64, error) {
	return SearchSkillsWithCategoryFilter(keyword, SkillCategoryFilter{LegacyCategory: category}, page, perPage, includeDisabled, includeDeleted)
}

func SearchSkillsWithCategoryFilter(keyword string, filter SkillCategoryFilter, page, perPage int, includeDisabled, includeDeleted bool) ([]Skill, int64, error) {
	deletedFilter := SkillDeletedNormal
	if includeDeleted {
		deletedFilter = SkillDeletedAll
	}
	return SearchSkillsWithOptions(keyword, filter, page, perPage, includeDisabled, deletedFilter, "", "")
}

type SkillDeletedFilter string

const (
	SkillDeletedNormal SkillDeletedFilter = "normal"
	SkillDeletedOnly   SkillDeletedFilter = "deleted"
	SkillDeletedAll    SkillDeletedFilter = "all"
)

func skillListOrder(sortField, sortOrder string) string {
	columns := map[string]string{
		"id":           "skills.id",
		"name":         "skills.name",
		"display_name": "skills.display_name",
		"downloads":    "skills.downloads",
		"updated_at":   "skills.updated_at",
	}
	column, ok := columns[sortField]
	if !ok || (sortOrder != "asc" && sortOrder != "desc") {
		return "skills.downloads DESC, skills.id DESC"
	}
	direction := strings.ToUpper(sortOrder)
	if column == "skills.id" {
		return column + " " + direction
	}
	return column + " " + direction + ", skills.id " + direction
}

func buildSkillSearchQuery(keyword string, filter SkillCategoryFilter, includeDisabled bool, deletedFilter SkillDeletedFilter) *gorm.DB {
	query := DB.Model(&Skill{})
	switch deletedFilter {
	case SkillDeletedOnly:
		query = query.Where("skills.is_deleted = ?", true)
	case SkillDeletedAll:
	default:
		query = query.Where("skills.is_deleted = ?", false)
	}
	if !includeDisabled {
		query = query.Where("skills.status = ?", 1)
	}
	query = applySkillCategoryFilter(query, filter)
	if keyword != "" {
		query = query.Where("name LIKE ? OR display_name LIKE ? OR description LIKE ? OR submitter LIKE ?",
			"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
	}
	return query
}

const skillListSelectColumns = "skills.id, skills.name, skills.display_name, skills.category, skills.description, skills.scenario, skills.submitter, skills.tags, skills.downloads, skills.version, skills.status, skills.is_deleted, skills.created_at, skills.updated_at, skills.body_updated_at, skills.assets_updated_at"

func SearchSkillsWithOptions(keyword string, filter SkillCategoryFilter, page, perPage int, includeDisabled bool, deletedFilter SkillDeletedFilter, sortField, sortOrder string) ([]Skill, int64, error) {
	var skills []Skill
	var total int64

	// Count and list must use independent GORM statements. Reusing the count
	// statement leaks DISTINCT into the list SELECT. PostgreSQL then tries to
	// compare the JSON tags column and fails with SQLSTATE 42883 because json
	// has no equality operator.
	countQuery := buildSkillSearchQuery(keyword, filter, includeDisabled, deletedFilter)
	if err := countQuery.Distinct("skills.id").Count(&total).Error; err != nil {
		return nil, 0, err
	}

	listQuery := buildSkillSearchQuery(keyword, filter, includeDisabled, deletedFilter)
	err := listQuery.Select(skillListSelectColumns).
		Order(skillListOrder(sortField, sortOrder)).
		Offset((page - 1) * perPage).
		Limit(perPage).
		Find(&skills).Error
	return skills, total, err
}

func CreateSkill(skill *Skill) error {
	return DB.Create(skill).Error
}

func UpdateSkill(skill *Skill) error {
	return DB.Save(skill).Error
}

// DeleteSkill 软删:UPDATE is_deleted=1。幂等 - 已软删的再调用返回 affected=0,不报错
func DeleteSkill(id int) (int64, error) {
	res := DB.Model(&Skill{}).Where("id = ?", id).Update("is_deleted", true)
	return res.RowsAffected, res.Error
}

// RestoreSkill UPDATE is_deleted=0。幂等
func RestoreSkill(id int) (int64, error) {
	res := DB.Model(&Skill{}).Where("id = ?", id).Update("is_deleted", false)
	return res.RowsAffected, res.Error
}

// HardDeleteSkill 物理删除,admin force=1 分支专用
func HardDeleteSkill(id int) error {
	return DB.Delete(&Skill{}, id).Error
}

// 批量操作动作枚举
type SkillBatchAction string

const (
	SkillBatchSoftDelete  SkillBatchAction = "soft_delete"
	SkillBatchRestore     SkillBatchAction = "restore"
	SkillBatchSetCategory SkillBatchAction = "set_category"
)

// BatchUpdateSkills 批量软删/恢复/改分类。value 仅 set_category 使用
func BatchUpdateSkills(ids []int, action SkillBatchAction, value string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	q := DB.Model(&Skill{}).Where("id IN ?", ids)
	switch action {
	case SkillBatchSoftDelete:
		res := q.Update("is_deleted", true)
		return res.RowsAffected, res.Error
	case SkillBatchRestore:
		res := q.Update("is_deleted", false)
		return res.RowsAffected, res.Error
	case SkillBatchSetCategory:
		res := q.Update("category", value)
		return res.RowsAffected, res.Error
	default:
		return 0, nil
	}
}

// SkillPackageInfo 技能包摘要。Category 保留为旧接口字段,新逻辑中等同于 Code。
type SkillPackageInfo struct {
	Id          uint64 `json:"id"`
	Category    string `json:"category"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	SkillCount  int    `json:"skill_count"`
}

// SkillBrief 技能包内单个 skill 的简要信息
type SkillBrief struct {
	Id          int                 `json:"id"`
	Name        string              `json:"name"`
	DisplayName string              `json:"display_name"`
	Category    string              `json:"category"`
	Categories  []SkillCategoryView `json:"categories,omitempty" gorm:"-"`
	Description string              `json:"description"`
	Version     string              `json:"version"`
	Downloads   int                 `json:"downloads"`
	UpdatedAt   int64               `json:"updated_at"`
}

func fillSkillBriefCategories(skills []SkillBrief) ([]SkillBrief, error) {
	ids := make([]int, 0, len(skills))
	for _, skill := range skills {
		ids = append(ids, skill.Id)
	}
	categoryMap, err := BatchListSkillCategoriesForSkills(ids)
	if err != nil {
		return nil, err
	}
	for i := range skills {
		skills[i].Categories = categoryMap[skills[i].Id]
	}
	return skills, nil
}

// ListSkillPackages 按新 skill_package 分类统计未软删技能数量,返回技能包列表。
// 当新分类尚无数据时,回退旧 skills.category 聚合以兼容迁移前数据。
func ListSkillPackages() ([]SkillPackageInfo, error) {
	var results []SkillPackageInfo
	err := DB.Table("skill_categories AS c").
		Select("c.id, c.code AS category, c.code, c.name, c.description, COUNT(s.id) AS skill_count").
		Joins("JOIN skill_category_types AS t ON t.id = c.type_id AND t.code = ?", SkillCategoryTypePackage).
		Joins("LEFT JOIN skill_category_relations AS r ON r.category_id = c.id").
		Joins("LEFT JOIN skills AS s ON s.id = r.skill_id AND s.is_deleted = ? AND s.status = ?", false, 1).
		Where("c.is_deleted = ? AND c.status = ? AND t.status = ?", false, 1, 1).
		Group("c.id, c.code, c.name, c.description").
		Having("COUNT(s.id) > 0").
		Order("c.sort_order ASC, c.id DESC").
		Find(&results).Error
	if err != nil || len(results) > 0 {
		return results, err
	}

	err = DB.Model(&Skill{}).
		Select("category, category AS code, category AS name, COUNT(*) as skill_count").
		Where("is_deleted = ? AND status = ? AND category != ?", false, 1, "").
		Group("category").
		Order("category").
		Find(&results).Error
	return results, err
}

// ListSkillsByCategory 返回指定技能包 code/category 下所有未软删 skill 的简要信息。
// 优先读新 skill_category_relations,没有结果时回退旧 skills.category。
func ListSkillsByCategory(category string) ([]SkillBrief, error) {
	var results []SkillBrief
	err := DB.Table("skills AS s").
		Select("s.id, s.name, s.display_name, s.category, s.description, s.version, s.downloads, s.updated_at").
		Joins("JOIN skill_category_relations AS r ON r.skill_id = s.id").
		Joins("JOIN skill_categories AS c ON c.id = r.category_id").
		Joins("JOIN skill_category_types AS t ON t.id = c.type_id AND t.code = ?", SkillCategoryTypePackage).
		Where("s.is_deleted = ? AND s.status = ? AND c.is_deleted = ? AND c.status = ? AND t.status = ? AND c.code = ?",
			false, 1, false, 1, 1, category).
		Order("r.sort_order ASC, s.downloads DESC, s.id DESC").
		Find(&results).Error
	if err != nil || len(results) > 0 {
		if err != nil {
			return results, err
		}
		return fillSkillBriefCategories(results)
	}

	err = DB.Model(&Skill{}).
		Select("id, name, display_name, category, description, version, downloads, updated_at").
		Where("is_deleted = ? AND status = ? AND category = ?", false, 1, category).
		Order("id ASC").
		Find(&results).Error
	if err != nil {
		return results, err
	}
	return fillSkillBriefCategories(results)
}

// ListSkillCategories 返回所有未软删 skill 的去重分类列表,按字母序
func ListSkillCategories() ([]string, error) {
	var result []string
	err := DB.Model(&Skill{}).
		Where("is_deleted = ? AND category != ?", false, "").
		Distinct("category").
		Order("category").
		Pluck("category", &result).Error
	return result, err
}

// GetSkillByNameAny 不走缓存,直接查 DB,包括已软删的。用于重名冲突检测
func GetSkillByNameAny(name string) (*Skill, error) {
	var skill Skill
	err := DB.Where("name = ?", name).First(&skill).Error
	if err != nil {
		return nil, err
	}
	return &skill, nil
}

func IncrementSkillDownloads(id int) error {
	err := DB.Model(&Skill{}).Where("id = ?", id).UpdateColumn("downloads", DB.Raw("downloads + 1")).Error
	if err != nil {
		return err
	}
	// Update cache
	skillCacheLock.Lock()
	defer skillCacheLock.Unlock()
	for _, s := range skillCache {
		if s.Id == id {
			s.Downloads++
			break
		}
	}
	return nil
}
