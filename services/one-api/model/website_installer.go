package model

import "time"

// WebsiteInstaller is an immutable first-install upload, separate from signed updater artifacts.
type WebsiteInstaller struct {
	ID        string    `json:"id" gorm:"primaryKey;size:32"`
	Platform  string    `json:"platform" gorm:"index;size:32"`
	Version   string    `json:"version" gorm:"size:80"`
	Filename  string    `json:"filename" gorm:"size:160"`
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256" gorm:"size:64"`
	Notes     string    `json:"notes" gorm:"type:text"`
	CreatedBy int       `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// WebsiteInstallerChannel selects one public file per platform; withdrawal never falls back.
type WebsiteInstallerChannel struct {
	Platform  string    `json:"platform" gorm:"primaryKey;size:32"`
	ReleaseID string    `json:"release_id" gorm:"size:32"`
	Published bool      `json:"published"`
	UpdatedBy int       `json:"updated_by"`
	UpdatedAt time.Time `json:"updated_at"`
}
