package model

// ExpertProfile stores administrator-controlled presentation for a workbench
// that is shipped by the desktop application. It never defines execution.
type ExpertProfile struct {
	Key           string `json:"key" gorm:"primaryKey;size:80"`
	Name          string `json:"name" gorm:"size:100;not null"`
	Subtitle      string `json:"subtitle" gorm:"size:160"`
	Category      string `json:"category" gorm:"size:80"`
	Summary       string `json:"summary" gorm:"size:500"`
	Icon          string `json:"icon" gorm:"size:80"`
	Tags          string `json:"tags" gorm:"type:text"`
	Scenario      string `json:"scenario" gorm:"type:text"`
	Materials     string `json:"materials" gorm:"type:text"`
	RelatedSkills string `json:"related_skills" gorm:"type:text"`
	SortOrder     int    `json:"sort_order" gorm:"default:0"`
	Published     bool   `json:"published" gorm:"default:false"`
	UpdatedAt     int64  `json:"updated_at" gorm:"autoUpdateTime"`
}
