package model

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

// ExpertProfile stores administrator-controlled presentation for a workbench
// that is shipped by the desktop application. It never defines execution.
type ExpertProfile struct {
	Key            string `json:"key" gorm:"primaryKey;size:80"`
	Name           string `json:"name" gorm:"size:100;not null"`
	Subtitle       string `json:"subtitle" gorm:"size:160"`
	Category       string `json:"category" gorm:"size:80"`
	Summary        string `json:"summary" gorm:"size:500"`
	Icon           string `json:"icon" gorm:"type:text"`
	Tags           string `json:"tags" gorm:"type:text"`
	Scenario       string `json:"scenario" gorm:"type:text"`
	Materials      string `json:"materials" gorm:"type:text"`
	DetailSections string `json:"detail_sections" gorm:"type:text"`
	RelatedSkills  string `json:"related_skills" gorm:"type:text"`
	SortOrder      int    `json:"sort_order" gorm:"default:0"`
	Published      bool   `json:"published" gorm:"default:false"`
	UpdatedAt      int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

// ExpertCategory stores administrator-managed marketplace categories shared
// by individual experts and expert teams.
type ExpertCategory struct {
	Id          uint64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string `json:"name" gorm:"size:80;uniqueIndex;not null"`
	Description string `json:"description" gorm:"size:300"`
	Status      int    `json:"status" gorm:"default:1"`
	SortOrder   int    `json:"sort_order" gorm:"default:0"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func EnsureDefaultExpertCategories() error {
	defaults := []ExpertCategory{
		{Name: "空间分析", Description: "空间数据、自然资源和国土规划分析类专家", Status: 1, SortOrder: 10},
		{Name: "办公工具", Description: "文档、会议和文件处理类专家", Status: 1, SortOrder: 20},
	}
	for _, category := range defaults {
		var existing ExpertCategory
		err := DB.Where("name = ?", category.Name).First(&existing).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := DB.Create(&category).Error; err != nil {
			return err
		}
	}
	return nil
}

func ValidateExpertCategory(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("请选择专家分类")
	}
	var count int64
	if err := DB.Model(&ExpertCategory{}).Where("name = ? AND status = ?", name, 1).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return errors.New("专家分类不存在或已禁用，请先在分类管理中创建并启用")
	}
	return nil
}
