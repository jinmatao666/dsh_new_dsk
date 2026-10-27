package model

import (
	"time"

	"gorm.io/gorm"
)

// DesktopUpdate is an immutable, verified upload. Publication is owned by its platform channel.
type DesktopUpdate struct {
	ID                string    `json:"id" gorm:"primaryKey;size:32"`
	Platform          string    `json:"platform" gorm:"index:desktop_update_platform_version;size:32"`
	Version           string    `json:"version" gorm:"index:desktop_update_platform_version;size:80"`
	Notes             string    `json:"notes" gorm:"type:text"`
	Manifest          string    `json:"-" gorm:"type:text"`
	ManifestSignature string    `json:"-" gorm:"type:text"`
	Size              int64     `json:"size"`
	CreatedBy         int       `json:"created_by"`
	CreatedAt         time.Time `json:"created_at"`
}

func migrateDesktopUpdates(db *gorm.DB) error {
	if err := db.AutoMigrate(&DesktopUpdate{}, &DesktopUpdateChannel{}); err != nil {
		return err
	}
	// 同一版本允许上传多个独立更新包；保留发布记录，仅移除旧的唯一索引。
	if db.Migrator().HasIndex(&DesktopUpdate{}, "desktop_update_version") {
		return db.Migrator().DropIndex(&DesktopUpdate{}, "desktop_update_version")
	}
	return nil
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
