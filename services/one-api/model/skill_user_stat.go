package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SkillUserStat 按稳定的用户、技能 ID 汇总；Installed 表示曾经安装成功。
type SkillUserStat struct {
	UserID               int   `gorm:"primaryKey;autoIncrement:false"`
	SkillID              int   `gorm:"primaryKey;autoIncrement:false;index"`
	DownloadCount        int64 `gorm:"not null;default:0"`
	Installed            bool  `gorm:"not null;default:false"`
	FirstDownloadedAt    *time.Time
	LastDownloadedAt     *time.Time
	FirstInstalledAt     *time.Time
	LastInstalledAt      *time.Time
	LastInstalledVersion string `gorm:"size:50"`
}

// SkillDownloadEvent 同一次下载的上报重试共用 EventID，不重复累加。
type SkillDownloadEvent struct {
	UserID       int    `gorm:"primaryKey;autoIncrement:false"`
	EventID      string `gorm:"primaryKey;size:64"`
	SkillID      int    `gorm:"not null;index"`
	Version      string `gorm:"size:50"`
	DownloadedAt time.Time
	InstalledAt  *time.Time
}

func MigrateSkillUserStats() error {
	if err := DB.AutoMigrate(&SkillUserStat{}, &SkillDownloadEvent{}); err != nil {
		return err
	}
	// 历史安装可以回填；旧的技能总下载量无法反推出各用户的下载次数。
	for offset := 0; ; offset += 500 {
		var installations []SkillInstallation
		if err := DB.Order("user_id, skill_id").Limit(500).Offset(offset).Find(&installations).Error; err != nil {
			return err
		}
		rows := make([]SkillUserStat, 0, len(installations))
		for _, installation := range installations {
			rows = append(rows, SkillUserStat{UserID: installation.UserID, SkillID: installation.SkillID,
				Installed: true, FirstInstalledAt: &installation.InstalledAt, LastInstalledAt: &installation.InstalledAt})
		}
		if len(rows) > 0 {
			if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
				return err
			}
		}
		if len(installations) < 500 {
			return nil
		}
	}
}

func recordSkillDownload(tx *gorm.DB, id, userID int, eventID, version string) (bool, error) {
	if id < 1 || userID < 1 || eventID == "" || len(eventID) > 64 || len(version) > 50 {
		return false, errors.New("invalid skill download event")
	}
	now := time.Now()
	event := SkillDownloadEvent{UserID: userID, SkillID: id, EventID: eventID, Version: version, DownloadedAt: now}
	insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&event)
	if insert.Error != nil {
		return false, insert.Error
	}
	if insert.RowsAffected == 0 {
		var previous SkillDownloadEvent
		if err := tx.Where("user_id = ? AND event_id = ?", userID, eventID).First(&previous).Error; err != nil {
			return false, err
		}
		if previous.SkillID != id || previous.Version != version {
			return false, errors.New("download event does not match skill or version")
		}
		return false, nil
	}
	result := tx.Model(&Skill{}).Where("id = ? AND status = ? AND is_deleted = ?", id, 1, false).UpdateColumn("downloads", gorm.Expr("downloads + 1"))
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected != 1 {
		return false, gorm.ErrRecordNotFound
	}
	row := SkillUserStat{UserID: userID, SkillID: id, DownloadCount: 1, FirstDownloadedAt: &now, LastDownloadedAt: &now}
	err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "skill_id"}}, DoUpdates: clause.Assignments(map[string]interface{}{
		"download_count":      gorm.Expr("skill_user_stats.download_count + 1"),
		"first_downloaded_at": gorm.Expr("COALESCE(skill_user_stats.first_downloaded_at, ?)", now), "last_downloaded_at": now,
	})}).Create(&row).Error
	return err == nil, err
}

func RecordSkillDownload(id, userID int, eventID, version string) error {
	var added bool
	err := DB.Transaction(func(tx *gorm.DB) (err error) {
		added, err = recordSkillDownload(tx, id, userID, eventID, version)
		return
	})
	if err == nil && added {
		incrementSkillDownloadCache(id)
	}
	return err
}

func recordSkillInstallation(tx *gorm.DB, id, userID int, eventID string) error {
	var event SkillDownloadEvent
	if err := tx.Where("user_id = ? AND skill_id = ? AND event_id = ?", userID, id, eventID).First(&event).Error; err != nil {
		return err
	}
	now := time.Now()
	accepted := tx.Model(&SkillDownloadEvent{}).Where("user_id = ? AND event_id = ? AND installed_at IS NULL", userID, eventID).UpdateColumn("installed_at", now)
	if accepted.Error != nil {
		return accepted.Error
	}
	if accepted.RowsAffected == 0 {
		return nil
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&SkillInstallation{SkillID: id, UserID: userID, InstalledAt: now}).Error; err != nil {
		return err
	}
	return tx.Model(&SkillUserStat{}).Where("user_id = ? AND skill_id = ?", userID, id).Updates(map[string]interface{}{
		"installed": true, "first_installed_at": gorm.Expr("COALESCE(first_installed_at, ?)", now), "last_installed_at": now, "last_installed_version": event.Version,
	}).Error
}

func RecordSkillInstallation(id, userID int, eventID string) error {
	if id < 1 || userID < 1 || eventID == "" || len(eventID) > 64 {
		return errors.New("invalid skill installation event")
	}
	return DB.Transaction(func(tx *gorm.DB) error { return recordSkillInstallation(tx, id, userID, eventID) })
}

func incrementSkillDownloadCache(id int) {
	skillCacheLock.Lock()
	defer skillCacheLock.Unlock()
	for _, skill := range skillCache {
		if skill.Id == id {
			skill.Downloads++
			break
		}
	}
}
