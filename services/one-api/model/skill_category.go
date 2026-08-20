package model

import (
	"errors"
	"strings"
	"time"

	"github.com/songquanpeng/one-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	SkillCategoryTypePackage  = "skill_package"
	SkillCategoryTypeFunction = "function_category"
)

type SkillCategoryType struct {
	Id          uint64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Code        string `json:"code" gorm:"size:64;uniqueIndex;not null"`
	Name        string `json:"name" gorm:"size:64;not null"`
	Description string `json:"description" gorm:"size:500;default:''"`
	Status      int    `json:"status" gorm:"default:1"`
	SortOrder   int    `json:"sort_order" gorm:"default:0"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

type SkillCategory struct {
	Id          uint64  `json:"id" gorm:"primaryKey;autoIncrement"`
	TypeId      uint64  `json:"type_id" gorm:"uniqueIndex:idx_skill_categories_type_code;index;not null"`
	ParentId    *uint64 `json:"parent_id" gorm:"index"`
	Code        string  `json:"code" gorm:"uniqueIndex:idx_skill_categories_type_code;size:100;not null"`
	Name        string  `json:"name" gorm:"size:100;not null"`
	Description string  `json:"description" gorm:"size:500;default:''"`
	Status      int     `json:"status" gorm:"default:1"`
	IsDeleted   bool    `json:"is_deleted" gorm:"column:is_deleted;default:0"`
	SortOrder   int     `json:"sort_order" gorm:"default:0"`
	CreatedAt   int64   `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64   `json:"updated_at" gorm:"autoUpdateTime"`
}

type SkillCategoryRelation struct {
	Id         uint64 `json:"id" gorm:"primaryKey;autoIncrement"`
	SkillId    int    `json:"skill_id" gorm:"uniqueIndex:idx_skill_category_relations_skill_category;index;not null"`
	CategoryId uint64 `json:"category_id" gorm:"uniqueIndex:idx_skill_category_relations_skill_category;index;not null"`
	SortOrder  int    `json:"sort_order" gorm:"default:0"`
	IsFeatured bool   `json:"is_featured" gorm:"column:is_featured;default:0"`
	CreatedAt  int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt  int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

type SkillCategoryView struct {
	Id          uint64 `json:"id"`
	TypeId      uint64 `json:"type_id"`
	TypeCode    string `json:"type_code"`
	TypeName    string `json:"type_name"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      int    `json:"status"`
	SortOrder   int    `json:"sort_order"`
	SkillCount  int    `json:"skill_count"`
}

type SkillCategoryFilter struct {
	LegacyCategory string
	CategoryType   string
	CategoryCode   string
	CategoryId     uint64
}

func normalizeCategoryCode(code string) string {
	return strings.TrimSpace(code)
}

func ensureDefaultSkillCategoryTypes() error {
	now := time.Now().Unix()
	defaults := []SkillCategoryType{
		{
			Code:        SkillCategoryTypePackage,
			Name:        "技能包",
			Description: "专业广场技能包板块使用",
			Status:      1,
			SortOrder:   10,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			Code:        SkillCategoryTypeFunction,
			Name:        "功能分类",
			Description: "独立技能筛选tag使用",
			Status:      1,
			SortOrder:   20,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}
	for _, item := range defaults {
		item := item
		err := DB.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "code"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"name":        item.Name,
				"description": item.Description,
				"status":      item.Status,
				"sort_order":  item.SortOrder,
				"updated_at":  now,
			}),
		}).Create(&item).Error
		if err != nil {
			return err
		}
	}
	return nil
}

func migrateLegacySkillCategories() error {
	var typ SkillCategoryType
	if err := DB.Where("code = ?", SkillCategoryTypePackage).First(&typ).Error; err != nil {
		return err
	}

	var legacyCategories []string
	if err := DB.Model(&Skill{}).
		Where("category IS NOT NULL AND category != ?", "").
		Distinct("category").
		Order("category").
		Pluck("category", &legacyCategories).Error; err != nil {
		return err
	}
	if len(legacyCategories) == 0 {
		return nil
	}

	now := time.Now().Unix()
	for _, raw := range legacyCategories {
		code := normalizeCategoryCode(raw)
		if code == "" {
			continue
		}
		category := SkillCategory{
			TypeId:    typ.Id,
			Code:      code,
			Name:      code,
			Status:    1,
			SortOrder: 0,
			CreatedAt: now,
			UpdatedAt: now,
		}
		err := DB.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "type_id"}, {Name: "code"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"name":       category.Name,
				"updated_at": now,
			}),
		}).Create(&category).Error
		if err != nil {
			return err
		}
	}

	type relationSeed struct {
		SkillId    int
		CategoryId uint64
	}
	var seeds []relationSeed
	joinClause := "JOIN skill_categories AS c ON c.type_id = ? AND c.code = s.category"
	if common.UsingMySQL {
		joinClause = "JOIN skill_categories AS c ON c.type_id = ? AND c.code COLLATE utf8mb4_unicode_ci = s.category COLLATE utf8mb4_unicode_ci"
	}
	if err := DB.Table("skills AS s").
		Select("s.id AS skill_id, c.id AS category_id").
		Joins(joinClause, typ.Id).
		Where("s.category IS NOT NULL AND s.category != ?", "").
		Scan(&seeds).Error; err != nil {
		return err
	}
	for _, seed := range seeds {
		rel := SkillCategoryRelation{
			SkillId:    seed.SkillId,
			CategoryId: seed.CategoryId,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		err := DB.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "skill_id"}, {Name: "category_id"}},
			DoNothing: true,
		}).Create(&rel).Error
		if err != nil {
			return err
		}
	}
	return nil
}

func migrateSkillCategorySchema() error {
	if err := DB.AutoMigrate(&SkillCategoryType{}); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&SkillCategory{}); err != nil {
		return err
	}
	if err := dropSkillCategoryDisplayColumns(); err != nil {
		return err
	}
	if err := DB.AutoMigrate(&SkillCategoryRelation{}); err != nil {
		return err
	}
	if err := ensureDefaultSkillCategoryTypes(); err != nil {
		return err
	}
	return nil
}

func dropSkillCategoryDisplayColumns() error {
	for _, column := range []string{"icon", "cover_url", "color", "metadata"} {
		if DB.Migrator().HasColumn(&SkillCategory{}, column) {
			if err := DB.Migrator().DropColumn(&SkillCategory{}, column); err != nil {
				return err
			}
		}
	}
	return nil
}

func ListSkillCategoryTypes(includeDisabled bool) ([]SkillCategoryType, error) {
	var types []SkillCategoryType
	query := DB.Model(&SkillCategoryType{})
	if !includeDisabled {
		query = query.Where("status = ?", 1)
	}
	err := query.Order("sort_order ASC, id ASC").Find(&types).Error
	return types, err
}

func CreateSkillCategoryType(typ *SkillCategoryType) error {
	typ.Code = normalizeCategoryCode(typ.Code)
	if typ.Code == "" || strings.TrimSpace(typ.Name) == "" {
		return errors.New("code and name are required")
	}
	if typ.Status == 0 {
		typ.Status = 1
	}
	return DB.Create(typ).Error
}

func UpdateSkillCategoryType(typ *SkillCategoryType) error {
	if typ.Id == 0 {
		return errors.New("id is required")
	}
	typ.Code = normalizeCategoryCode(typ.Code)
	if typ.Code == "" || strings.TrimSpace(typ.Name) == "" {
		return errors.New("code and name are required")
	}
	return DB.Model(&SkillCategoryType{}).Where("id = ?", typ.Id).
		Select("code", "name", "description", "status", "sort_order").
		Updates(map[string]interface{}{
			"code":        typ.Code,
			"name":        typ.Name,
			"description": typ.Description,
			"status":      typ.Status,
			"sort_order":  typ.SortOrder,
		}).Error
}

func ListSkillCategoriesByType(typeCode string, includeDisabled bool) ([]SkillCategoryView, error) {
	var categories []SkillCategoryView
	query := DB.Table("skill_categories AS c").
		Select("c.id, c.type_id, t.code AS type_code, t.name AS type_name, c.code, c.name, c.description, c.status, c.sort_order, COUNT(r.skill_id) AS skill_count").
		Joins("JOIN skill_category_types AS t ON t.id = c.type_id").
		Joins("LEFT JOIN skill_category_relations AS r ON r.category_id = c.id").
		Where("c.is_deleted = ?", false)
	if typeCode != "" {
		query = query.Where("t.code = ?", typeCode)
	}
	if !includeDisabled {
		query = query.Where("c.status = ? AND t.status = ?", 1, 1)
	}
	err := query.
		Group("c.id, c.type_id, t.code, t.name, c.code, c.name, c.description, c.status, c.sort_order").
		Order("t.sort_order ASC, c.sort_order ASC, c.id DESC").
		Find(&categories).Error
	return categories, err
}

func CountSkillCategoryRelations(categoryId uint64) (int64, error) {
	if categoryId == 0 {
		return 0, nil
	}
	var count int64
	err := DB.Model(&SkillCategoryRelation{}).Where("category_id = ?", categoryId).Count(&count).Error
	return count, err
}

func GetSkillCategoryById(id uint64) (*SkillCategory, error) {
	var category SkillCategory
	err := DB.First(&category, id).Error
	if err != nil {
		return nil, err
	}
	return &category, nil
}

func CreateSkillCategory(category *SkillCategory) error {
	category.Code = normalizeCategoryCode(category.Code)
	if category.TypeId == 0 || category.Code == "" || strings.TrimSpace(category.Name) == "" {
		return errors.New("type_id, code and name are required")
	}
	if category.Status == 0 {
		category.Status = 1
	}
	return DB.Create(category).Error
}

func UpdateSkillCategory(category *SkillCategory) error {
	if category.Id == 0 {
		return errors.New("id is required")
	}
	category.Code = normalizeCategoryCode(category.Code)
	if category.TypeId == 0 || category.Code == "" || strings.TrimSpace(category.Name) == "" {
		return errors.New("type_id, code and name are required")
	}
	return DB.Model(&SkillCategory{}).Where("id = ?", category.Id).
		Select("type_id", "parent_id", "code", "name", "description", "status", "sort_order").
		Updates(map[string]interface{}{
			"type_id":     category.TypeId,
			"parent_id":   category.ParentId,
			"code":        category.Code,
			"name":        category.Name,
			"description": category.Description,
			"status":      category.Status,
			"sort_order":  category.SortOrder,
		}).Error
}

func DeleteSkillCategory(id uint64) error {
	if id == 0 {
		return errors.New("id is required")
	}
	count, err := CountSkillCategoryRelations(id)
	if err != nil {
		return err
	}
	if count > 0 {
		return errors.New("分类下已绑定 skill，请先移除分类下的 skill 后再删除")
	}
	return DB.Model(&SkillCategory{}).Where("id = ?", id).Update("is_deleted", true).Error
}

func ListSkillCategoriesForSkill(skillId int) ([]SkillCategoryView, error) {
	if skillId == 0 {
		return []SkillCategoryView{}, nil
	}
	grouped, err := BatchListSkillCategoriesForSkills([]int{skillId})
	if err != nil {
		return nil, err
	}
	return grouped[skillId], nil
}

func BatchListSkillCategoriesForSkills(skillIds []int) (map[int][]SkillCategoryView, error) {
	result := make(map[int][]SkillCategoryView, len(skillIds))
	if len(skillIds) == 0 {
		return result, nil
	}

	type row struct {
		SkillId int `json:"skill_id"`
		SkillCategoryView
	}
	var rows []row
	err := DB.Table("skill_category_relations AS r").
		Select("r.skill_id, c.id, c.type_id, t.code AS type_code, t.name AS type_name, c.code, c.name, c.description, c.sort_order").
		Joins("JOIN skill_categories AS c ON c.id = r.category_id").
		Joins("JOIN skill_category_types AS t ON t.id = c.type_id").
		Where("r.skill_id IN ?", skillIds).
		Where("c.is_deleted = ? AND c.status = ? AND t.status = ?", false, 1, 1).
		Order("t.sort_order ASC, c.sort_order ASC, c.id ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.SkillId] = append(result[row.SkillId], row.SkillCategoryView)
	}
	return result, nil
}

func ReplaceSkillCategories(skillId int, categoryIds []uint64) error {
	if skillId == 0 {
		return errors.New("skill_id is required")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("skill_id = ?", skillId).Delete(&SkillCategoryRelation{}).Error; err != nil {
			return err
		}
		return appendSkillCategoriesTx(tx, []int{skillId}, categoryIds)
	})
}

func ReplaceSkillCategoriesByType(skillId int, typeCode string, categoryIds []uint64) error {
	if skillId == 0 || typeCode == "" {
		return errors.New("skill_id and type_code are required")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		sub := tx.Table("skill_categories AS c").
			Select("c.id").
			Joins("JOIN skill_category_types AS t ON t.id = c.type_id").
			Where("t.code = ?", typeCode)
		if err := tx.Where("skill_id = ? AND category_id IN (?)", skillId, sub).Delete(&SkillCategoryRelation{}).Error; err != nil {
			return err
		}
		return appendSkillCategoriesTx(tx, []int{skillId}, categoryIds)
	})
}

func AppendSkillCategories(skillIds []int, categoryIds []uint64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		return appendSkillCategoriesTx(tx, skillIds, categoryIds)
	})
}

func RemoveSkillCategories(skillIds []int, categoryIds []uint64) error {
	if len(skillIds) == 0 || len(categoryIds) == 0 {
		return nil
	}
	return DB.Where("skill_id IN ? AND category_id IN ?", skillIds, categoryIds).Delete(&SkillCategoryRelation{}).Error
}

func appendSkillCategoriesTx(tx *gorm.DB, skillIds []int, categoryIds []uint64) error {
	if len(skillIds) == 0 || len(categoryIds) == 0 {
		return nil
	}
	now := time.Now().Unix()
	var relations []SkillCategoryRelation
	for _, skillId := range skillIds {
		if skillId == 0 {
			continue
		}
		for _, categoryId := range categoryIds {
			if categoryId == 0 {
				continue
			}
			relations = append(relations, SkillCategoryRelation{
				SkillId:    skillId,
				CategoryId: categoryId,
				CreatedAt:  now,
				UpdatedAt:  now,
			})
		}
	}
	if len(relations) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "skill_id"}, {Name: "category_id"}},
		DoNothing: true,
	}).Create(&relations).Error
}

func applySkillCategoryFilter(query *gorm.DB, filter SkillCategoryFilter) *gorm.DB {
	if filter.CategoryId != 0 {
		return query.Joins("JOIN skill_category_relations AS scr_filter ON scr_filter.skill_id = skills.id").
			Where("scr_filter.category_id = ?", filter.CategoryId)
	}
	if filter.CategoryType != "" && filter.CategoryCode != "" {
		return query.Joins("JOIN skill_category_relations AS scr_filter ON scr_filter.skill_id = skills.id").
			Joins("JOIN skill_categories AS sc_filter ON sc_filter.id = scr_filter.category_id").
			Joins("JOIN skill_category_types AS sct_filter ON sct_filter.id = sc_filter.type_id").
			Where("sct_filter.code = ? AND sc_filter.code = ? AND sc_filter.is_deleted = ? AND sc_filter.status = ? AND sct_filter.status = ?",
				filter.CategoryType, filter.CategoryCode, false, 1, 1)
	}
	if filter.LegacyCategory != "" {
		return query.Where("category = ?", filter.LegacyCategory)
	}
	return query
}

func ListFunctionCategoriesForStandaloneSkills() ([]SkillPackageInfo, error) {
	var results []SkillPackageInfo
	err := DB.Table("skill_categories AS c").
		Select("c.id, c.code AS category, c.code, c.name, c.description, COUNT(s.id) AS skill_count").
		Joins("JOIN skill_category_types AS t ON t.id = c.type_id AND t.code = ?", SkillCategoryTypeFunction).
		Joins("LEFT JOIN skill_category_relations AS r ON r.category_id = c.id").
		Joins("LEFT JOIN skills AS s ON s.id = r.skill_id AND s.is_deleted = ? AND s.status = ?", false, 1).
		Where("c.is_deleted = ? AND c.status = ? AND t.status = ?", false, 1, 1).
		Group("c.id, c.code, c.name, c.description").
		Having("COUNT(s.id) > 0").
		Order("c.sort_order ASC, c.id DESC").
		Find(&results).Error
	return results, err
}
