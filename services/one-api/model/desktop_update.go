package model

import "time"

// DesktopUpdate is an immutable, verified upload. Publication is owned by its platform channel.
type DesktopUpdate struct {
	ID                string    `json:"id" gorm:"primaryKey;size:32"`
	Platform          string    `json:"platform" gorm:"uniqueIndex:desktop_update_version;size:32"`
	Version           string    `json:"version" gorm:"uniqueIndex:desktop_update_version;size:80"`
	Notes             string    `json:"notes" gorm:"type:text"`
	Manifest          string    `json:"-" gorm:"type:text"`
	ManifestSignature string    `json:"-" gorm:"type:text"`
	Size              int64     `json:"size"`
	CreatedBy         int       `json:"created_by"`
	CreatedAt         time.Time `json:"created_at"`
}

// DesktopUpdateChannel retains its high-water version after withdrawal; it never falls back.
type DesktopUpdateChannel struct {
	Platform  string    `json:"platform" gorm:"primaryKey;size:32"`
	Version   string    `json:"version" gorm:"size:80"`
	ReleaseID string    `json:"release_id" gorm:"size:32"`
	Published bool      `json:"published"`
	UpdatedBy int       `json:"updated_by"`
	UpdatedAt time.Time `json:"updated_at"`
}
