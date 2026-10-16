package model

import (
	"time"
)

// UserActivityLog 用户账户动态（复用 logs 表，但只查询特定类型）
// 记录用户账户的所有变更操作，如后台修改积分、充值等

// GetUserActivityLogs 获取用户的账户动态记录
// 只返回积分 / 会员时长 / 优惠券相关的权益变更（LogTypeTopup/Manage/System）。
// 登录、注册等行为日志以 LogTypeBehavior 单独归类，天然不在此范围内，
// 无需再按文案过滤——避免活动名/赠送文案含「登录」「注册」字样被误排除。
func GetUserActivityLogs(userId int, offset, limit int) ([]Log, int64, error) {
	var logs []Log
	var total int64

	query := DB.Model(&Log{}).
		Where("user_id = ? AND type IN (?, ?, ?)", userId, LogTypeTopup, LogTypeManage, LogTypeSystem)

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = query.Order("created_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&logs).Error

	return logs, total, err
}

// GetUserActivityLogsByTimeRange 获取指定时间范围内的用户账户动态
func GetUserActivityLogsByTimeRange(userId int, startTime, endTime time.Time, offset, limit int) ([]Log, int64, error) {
	var logs []Log
	var total int64

	query := DB.Model(&Log{}).
		Where("user_id = ? AND type IN (?, ?, ?) AND created_at BETWEEN ? AND ?",
			userId, LogTypeTopup, LogTypeManage, LogTypeSystem, startTime.Unix(), endTime.Unix())

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = query.Order("created_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&logs).Error

	return logs, total, err
}
