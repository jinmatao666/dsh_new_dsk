package model

import (
	"encoding/json"
	"strings"
)

type PersonalSkill struct {
	Id                  int             `json:"id" gorm:"primaryKey;autoIncrement"`
	Name                string          `json:"name" gorm:"size:100;not null"`
	Description         string          `json:"description" gorm:"size:500;default:''"`
	Scenario            string          `json:"scenario" gorm:"size:500;default:''"`
	Content             string          `json:"content" gorm:"type:text;not null"`
	Body                string          `json:"body" gorm:"type:text"`
	Assets              string          `json:"assets" gorm:"type:text"`
	Owner               string          `json:"owner" gorm:"size:100;not null;index"`
	ForkedFrom          string          `json:"forked_from" gorm:"size:100;default:''"`
	ForkedFromUpdated   string          `json:"forked_from_updated" gorm:"size:100;default:''"`
	ForkedFromContent   string          `json:"forked_from_content" gorm:"type:text"`
	ForkedFromSubmitter string          `json:"forked_from_submitter" gorm:"size:100;default:''"`
	Tags                json.RawMessage `json:"tags" gorm:"type:json"`
	CreatedAt           int64           `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt           int64           `json:"updated_at" gorm:"autoUpdateTime"`
	BodyUpdatedAt       int64           `json:"body_updated_at" gorm:"default:0"`
	AssetsUpdatedAt     int64           `json:"assets_updated_at" gorm:"default:0"`
}

// EffectiveBody returns the body text used for LLM injection.
// Falls back to legacy Content when Body has not been migrated yet.
func (s *PersonalSkill) EffectiveBody() string {
	if s.Body != "" {
		return s.Body
	}
	return s.Content
}

func GetPersonalSkillsByOwner(owner string, page, perPage int) ([]PersonalSkill, int64, error) {
	// 初始化为非 nil 空切片：查无数据时序列化为 [] 而非 null，避免前端 .length 崩溃
	skills := []PersonalSkill{}
	var total int64
	query := DB.Model(&PersonalSkill{}).Where("owner = ?", owner)
	query.Count(&total)
	err := query.Order("id DESC").
		Offset((page - 1) * perPage).
		Limit(perPage).
		Find(&skills).Error
	return skills, total, err
}

// SearchPersonalSkills returns personal skills matched by keyword (LIKE on
// name/description/owner) and optionally filtered to a specific owner.
// Used by the admin skill management page (no per-user scoping).
func SearchPersonalSkills(keyword, owner string, page, perPage int) ([]PersonalSkill, int64, error) {
	return SearchPersonalSkillsSorted(keyword, owner, page, perPage, "", "")
}

func personalSkillListOrder(sortField, sortOrder string) string {
	columns := map[string]string{
		"id":         "id",
		"name":       "name",
		"updated_at": "updated_at",
	}
	column, ok := columns[sortField]
	if !ok || (sortOrder != "asc" && sortOrder != "desc") {
		return "id DESC"
	}
	direction := strings.ToUpper(sortOrder)
	if column == "id" {
		return column + " " + direction
	}
	return column + " " + direction + ", id " + direction
}

func SearchPersonalSkillsSorted(keyword, owner string, page, perPage int, sortField, sortOrder string) ([]PersonalSkill, int64, error) {
	// 初始化为非 nil 空切片：查无数据时序列化为 [] 而非 null
	skills := []PersonalSkill{}
	var total int64
	query := DB.Model(&PersonalSkill{})
	if owner != "" {
		query = query.Where("owner = ?", owner)
	}
	if keyword != "" {
		query = query.Where("name LIKE ? OR description LIKE ? OR owner LIKE ?",
			"%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
	}
	query.Count(&total)
	err := query.Order(personalSkillListOrder(sortField, sortOrder)).
		Offset((page - 1) * perPage).
		Limit(perPage).
		Find(&skills).Error
	return skills, total, err
}

func GetPersonalSkillById(id int) (*PersonalSkill, error) {
	var skill PersonalSkill
	err := DB.First(&skill, id).Error
	if err != nil {
		return nil, err
	}
	return &skill, nil
}

func CreatePersonalSkill(skill *PersonalSkill) error {
	return DB.Create(skill).Error
}

func UpdatePersonalSkill(skill *PersonalSkill) error {
	return DB.Save(skill).Error
}

func DeletePersonalSkill(id int) error {
	return DB.Delete(&PersonalSkill{}, id).Error
}
