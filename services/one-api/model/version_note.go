package model

import (
	"errors"
	"time"
)

// VersionNote 版本更新说明.
// 后台为唯一数据源,发布脚本通过公开查询接口按 platform+version 读取 notes 写入 latest.json。
// platform+version 唯一,避免同一版本重复说明。
type VersionNote struct {
	Id        int       `json:"id" gorm:"primaryKey;autoIncrement"`
	Platform  string    `json:"platform" gorm:"type:varchar(20);not null;default:'app';index:idx_platform_version,unique;comment:平台 app/web/backend"`
	Version   string    `json:"version" gorm:"type:varchar(50);not null;index:idx_platform_version,unique;comment:版本号 如 2.0.4"`
	Notes     string    `json:"notes" gorm:"type:text;not null;comment:更新说明(Markdown)"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
}

// 平台常量
const (
	VersionPlatformApp     = "app"
	VersionPlatformWeb     = "web"
	VersionPlatformBackend = "backend"
)

func (VersionNote) TableName() string {
	return "version_notes"
}

// normalizeVersionPlatform 把任意输入收敛到已知平台,默认 app。
func normalizeVersionPlatform(p string) string {
	switch p {
	case VersionPlatformWeb:
		return VersionPlatformWeb
	case VersionPlatformBackend:
		return VersionPlatformBackend
	default:
		return VersionPlatformApp
	}
}

// ListVersionNotes 后台:按平台列出全部说明(不传 platform 则全部),按创建时间倒序。
func ListVersionNotes(platform string) ([]*VersionNote, error) {
	var notes []*VersionNote
	q := DB.Order("created_at desc, id desc")
	if platform != "" {
		q = q.Where("platform = ?", normalizeVersionPlatform(platform))
	}
	err := q.Find(&notes).Error
	return notes, err
}

// GetVersionNote 按 platform+version 查询单条说明(供发布脚本读取)。
func GetVersionNote(platform, version string) (*VersionNote, error) {
	if version == "" {
		return nil, errors.New("版本号不能为空")
	}
	var note VersionNote
	err := DB.Where("platform = ? AND version = ?", normalizeVersionPlatform(platform), version).
		First(&note).Error
	if err != nil {
		return nil, err
	}
	return &note, nil
}

// CreateVersionNote 后台:新建更新说明。
func CreateVersionNote(note *VersionNote) error {
	note.Platform = normalizeVersionPlatform(note.Platform)
	if note.Version == "" {
		return errors.New("版本号不能为空")
	}
	if note.Notes == "" {
		return errors.New("更新说明不能为空")
	}
	return DB.Create(note).Error
}

// UpdateVersionNote 后台:更新说明内容(platform/version/notes)。
func UpdateVersionNote(note *VersionNote) error {
	if note.Id == 0 {
		return errors.New("ID不能为空")
	}
	note.Platform = normalizeVersionPlatform(note.Platform)
	return DB.Model(&VersionNote{}).Where("id = ?", note.Id).
		Select("platform", "version", "notes").
		Updates(note).Error
}

// DeleteVersionNote 后台:删除说明。
func DeleteVersionNote(id int) error {
	if id == 0 {
		return errors.New("ID不能为空")
	}
	return DB.Where("id = ?", id).Delete(&VersionNote{}).Error
}
