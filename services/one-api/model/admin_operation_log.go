package model

import (
	"fmt"
	"time"
)

// AdminOperationLog 后台操作记录：记录管理员对后台数据的写操作（审计用途）
type AdminOperationLog struct {
	Id            int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	AdminId       int       `json:"admin_id" gorm:"index;not null"`
	AdminUsername string    `json:"admin_username" gorm:"type:varchar(64);index;default:''"`
	AdminRole     int       `json:"admin_role" gorm:"default:0"`
	Action        string    `json:"action" gorm:"type:varchar(64);index;default:''"`
	Module        string    `json:"module" gorm:"type:varchar(32);index;default:''"`
	Method        string    `json:"method" gorm:"type:varchar(8);default:''"`
	Path          string    `json:"path" gorm:"type:varchar(255);default:''"`
	TargetId      string    `json:"target_id" gorm:"type:varchar(64);default:''"`
	StatusCode    int       `json:"status_code" gorm:"default:0"`
	Detail        string    `json:"detail" gorm:"type:text"`
	Ip            string    `json:"ip" gorm:"type:varchar(64);default:''"`
	CreatedAt     time.Time `json:"created_at" gorm:"index;autoCreateTime"`
}

func (AdminOperationLog) TableName() string {
	return "admin_operation_logs"
}

// CreateAdminOperationLog 写入一条后台操作记录
func CreateAdminOperationLog(entry *AdminOperationLog) error {
	if entry == nil {
		return nil
	}
	return DB.Create(entry).Error
}

// AdminOperationLogStats 操作统计结果（按动作分组）
type AdminOperationLogStats struct {
	Action       string `json:"action" gorm:"column:action"`
	Count        int64  `json:"count" gorm:"column:count"`
	UniqueAdmins int64  `json:"unique_admins" gorm:"column:unique_admins"`
}

// AdminOperationLogTrendPoint 操作趋势数据点
type AdminOperationLogTrendPoint struct {
	Date  string `json:"date" gorm:"column:date"`
	Count int64  `json:"count" gorm:"column:count"`
}

// GetAdminOperationLogStats 获取操作统计（按动作分组）
func GetAdminOperationLogStats(startTime, endTime time.Time, action, module string) ([]AdminOperationLogStats, error) {
	var stats []AdminOperationLogStats
	query := DB.Model(&AdminOperationLog{}).
		Select("action, COUNT(*) as count, COUNT(DISTINCT admin_id) as unique_admins").
		Where("created_at BETWEEN ? AND ?", startTime, endTime)

	if action != "" {
		query = query.Where("action = ?", action)
	}
	if module != "" {
		query = query.Where("module = ?", module)
	}

	err := query.Group("action").Order("count DESC").Find(&stats).Error
	return stats, err
}

// GetAdminOperationLogTrend 获取操作趋势
func GetAdminOperationLogTrend(startTime, endTime time.Time, action, module string) ([]AdminOperationLogTrendPoint, error) {
	var trend []AdminOperationLogTrendPoint
	query := DB.Model(&AdminOperationLog{}).
		Select("DATE(created_at) as date, COUNT(*) as count").
		Where("created_at BETWEEN ? AND ?", startTime, endTime)

	if action != "" {
		query = query.Where("action = ?", action)
	}
	if module != "" {
		query = query.Where("module = ?", module)
	}

	err := query.Group("DATE(created_at)").Order("date ASC").Find(&trend).Error
	return trend, err
}

// GetAdminOperationLogActions 返回最近一段时间内出现过的动作名（按出现频次降序）
func GetAdminOperationLogActions(since time.Time) ([]string, error) {
	var actions []string
	err := DB.Model(&AdminOperationLog{}).
		Select("action").
		Where("created_at >= ? AND action <> ''", since).
		Group("action").
		Order("COUNT(*) DESC").
		Pluck("action", &actions).Error
	return actions, err
}

// GetAdminOperationLogList 获取操作记录明细列表
func GetAdminOperationLogList(startTime, endTime time.Time, action, module, username string, offset, limit int) ([]AdminOperationLog, int64, error) {
	var logs []AdminOperationLog
	var total int64

	query := DB.Model(&AdminOperationLog{}).Where("created_at BETWEEN ? AND ?", startTime, endTime)

	if action != "" {
		query = query.Where("action = ?", action)
	}
	if module != "" {
		query = query.Where("module = ?", module)
	}
	if username != "" {
		query = query.Where("admin_username LIKE ?", fmt.Sprintf("%%%s%%", username))
	}

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&logs).Error
	return logs, total, err
}
