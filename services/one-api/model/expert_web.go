package model

// ExpertWebProfile is a published, independently deployed expert website.
// It does not affect the legacy shipped-workbench roster.
type ExpertWebProfile struct {
	CategoryOrder      int    `json:"category_order" gorm:"-"`
	Key                string `json:"key" gorm:"primaryKey;size:80"`
	Name               string `json:"name" gorm:"size:100;not null"`
	Subtitle           string `json:"subtitle" gorm:"size:160"`
	Category           string `json:"category" gorm:"size:80"`
	Summary            string `json:"summary" gorm:"size:500"`
	Icon               string `json:"icon" gorm:"type:text"`
	Tags               string `json:"tags" gorm:"type:text"`
	Scenario           string `json:"scenario" gorm:"type:text"`
	Materials          string `json:"materials" gorm:"type:text"`
	DetailSections     string `json:"detail_sections" gorm:"type:text"`
	FooterNote         string `json:"footer_note" gorm:"size:500"`
	Provider           string `json:"provider" gorm:"size:100;not null"`
	WorkbenchURL       string `json:"workbench_url" gorm:"size:2048;not null"`
	ProviderSecretHash string `json:"-" gorm:"size:64;not null"`
	SortOrder          *int   `json:"sort_order"`
	RequiresInternet   *bool  `json:"requires_internet" gorm:"not null;default:true"`
	CreatedAt          int64  `json:"created_at" gorm:"autoCreateTime"`
	Published          bool   `json:"published" gorm:"default:false"`
	UpdatedAt          int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

// ExpertWebTicket stores only a digest of the one-use launch credential.
type ExpertWebTicket struct {
	Hash      string `gorm:"primaryKey;size:64"`
	ExpertKey string `gorm:"size:80;index"`
	UserID    int
	ExpiresAt int64 `gorm:"index"`
	Consumed  bool  `gorm:"default:false"`
}
