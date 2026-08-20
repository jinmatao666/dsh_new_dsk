package model

import (
	"time"
)

// VersionRelease 发布记录（路线 B：后台定时探测各端线上版本变化反推）。
// append-only：探测器发现版本/信号变化时插入一条；不记录"具体谁发的"。
// signal 存探测依据：app/web 存版本号，backend 存进程 start_time。
type VersionRelease struct {
	Id         int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	Platform   string    `json:"platform" gorm:"type:varchar(20);not null;index;comment:平台 app/web/backend"`
	Version    string    `json:"version" gorm:"type:varchar(80);default:'';comment:版本号(后端无真实版本时为空)"`
	Signal     string    `json:"signal" gorm:"type:varchar(120);default:'';comment:探测依据 版本号或进程start_time"`
	DetectedAt time.Time `json:"detected_at" gorm:"autoCreateTime;index;comment:发现时间(非精确部署时刻)"`
}

func (VersionRelease) TableName() string {
	return "version_releases"
}

// GetLatestVersionRelease 取某平台最近一条记录（探测器用于比对是否变化）。
func GetLatestVersionRelease(platform string) (*VersionRelease, error) {
	var rec VersionRelease
	err := DB.Where("platform = ?", platform).
		Order("detected_at desc, id desc").First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// CreateVersionRelease 插入一条发布记录。
func CreateVersionRelease(rec *VersionRelease) error {
	return DB.Create(rec).Error
}

// ListVersionReleases 后台：按平台列出发布记录（不传 platform 则全部），按发现时间倒序，限量。
func ListVersionReleases(platform string, limit int) ([]*VersionRelease, error) {
	var records []*VersionRelease
	q := DB.Order("detected_at desc, id desc")
	if platform != "" {
		q = q.Where("platform = ?", platform)
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	err := q.Limit(limit).Find(&records).Error
	return records, err
}
