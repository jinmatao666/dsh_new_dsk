package model

import (
	"errors"
	"fmt"
	"time"
)

// OperationStats 运营看板统计数据
type OperationStats struct {
	// 基础维度信息
	Dimension string `json:"dimension"` // activity / crowd
	TargetId  int    `json:"target_id"`
	UserCount int    `json:"user_count"` // 筛选范围内用户总数

	// 活动专属指标
	ActivityStats *ActivityStatsDetail `json:"activity_stats,omitempty"`

	// 拉新与转化
	Acquisition *AcquisitionStats `json:"acquisition,omitempty"`

	// 活跃与留存
	Engagement *EngagementStats `json:"engagement,omitempty"`

	// 付费与营收
	Revenue *RevenueStats `json:"revenue,omitempty"`

	// 积分健康度
	QuotaHealth *QuotaHealthStats `json:"quota_health,omitempty"`

	// 趋势数据
	Trends []*TrendPoint `json:"trends,omitempty"`
}

// ActivityStatsDetail 活动统计详情（仅活动维度）
type ActivityStatsDetail struct {
	TotalUsers         int64 `json:"total_users"`          // 总参与人数（去重）
	TotalParticipations int64 `json:"total_participations"` // 总参与次数
	TotalGranted       int64 `json:"total_granted"`        // 总发放积分
	TodayUsers         int64 `json:"today_users"`          // 今日参与人数
}

// AcquisitionStats 拉新与转化
type AcquisitionStats struct {
	NewUsers           int     `json:"new_users"`            // 新注册数
	FirstConsumeUsers  int     `json:"first_consume_users"`  // 首次消费用户数
	ConversionRate     float64 `json:"conversion_rate"`      // 转化率
}

// EngagementStats 活跃与留存
type EngagementStats struct {
	DAU             int     `json:"dau"`               // 日活
	WAU             int     `json:"wau"`               // 周活
	MAU             int     `json:"mau"`               // 月活
	RetentionDay1   float64 `json:"retention_day1"`    // 次日留存率
	RetentionDay7   float64 `json:"retention_day7"`    // 7日留存率
}

// RevenueStats 付费与营收
type RevenueStats struct {
	TotalRevenue  int64   `json:"total_revenue"`   // 总充值额
	PayingUsers   int     `json:"paying_users"`    // 付费人数
	ARPU          float64 `json:"arpu"`            // 人均收入
	PayingRate    float64 `json:"paying_rate"`     // 付费率
}

// QuotaHealthStats 积分健康度
type QuotaHealthStats struct {
	TotalGranted     int64   `json:"total_granted"`      // 总发放
	TotalConsumed    int64   `json:"total_consumed"`     // 总消耗
	TotalRemaining   int64   `json:"total_remaining"`    // 沉淀剩余
	AvgConsumed      float64 `json:"avg_consumed"`       // 人均消耗
	ConsumptionRate  float64 `json:"consumption_rate"`   // 消耗率
}

// TrendPoint 趋势数据点
type TrendPoint struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// GetOperationStats 获取运营看板统计数据
func GetOperationStats(dimension string, targetId int, startTs, endTs int64) (*OperationStats, error) {
	if dimension != "activity" && dimension != "crowd" {
		return nil, errors.New("维度必须是 activity 或 crowd")
	}
	if targetId == 0 {
		return nil, errors.New("目标ID不能为空")
	}

	stats := &OperationStats{
		Dimension: dimension,
		TargetId:  targetId,
	}

	// 1. 获取用户集合
	var userIds []int
	var err error

	if dimension == "activity" {
		// 活动维度：从参与记录获取用户列表
		userIds, err = getActivityParticipantIds(targetId, startTs, endTs)
		if err != nil {
			return nil, fmt.Errorf("获取活动参与用户失败: %w", err)
		}

		// 活动专属统计
		activityStats, err := GetParticipationStats(targetId)
		if err != nil {
			return nil, fmt.Errorf("获取活动统计失败: %w", err)
		}
		stats.ActivityStats = &ActivityStatsDetail{
			TotalUsers:         activityStats["total_users"].(int64),
			TotalParticipations: activityStats["total_participations"].(int64),
			TotalGranted:       activityStats["total_granted"].(int64),
			TodayUsers:         activityStats["today_users"].(int64),
		}
	} else {
		// 人群维度：从人群规则获取用户列表
		crowd, err := GetUserCrowdById(targetId)
		if err != nil {
			return nil, fmt.Errorf("获取用户分群失败: %w", err)
		}
		userIds, err = crowd.GetMatchedUsersWithPagination(0, 0)
		if err != nil {
			return nil, fmt.Errorf("获取分群用户失败: %w", err)
		}
	}

	stats.UserCount = len(userIds)

	// 用户集为空时返回零值统计
	if len(userIds) == 0 {
		stats.Acquisition = &AcquisitionStats{}
		stats.Engagement = &EngagementStats{}
		stats.Revenue = &RevenueStats{}
		stats.QuotaHealth = &QuotaHealthStats{}
		stats.Trends = []*TrendPoint{}
		return stats, nil
	}

	// 2. 计算各组指标（基于 userIds + 时间范围）
	stats.Acquisition, err = getAcquisitionStats(userIds, startTs, endTs)
	if err != nil {
		return nil, fmt.Errorf("计算拉新转化失败: %w", err)
	}

	stats.Engagement, err = getEngagementStats(userIds, startTs, endTs)
	if err != nil {
		return nil, fmt.Errorf("计算活跃留存失败: %w", err)
	}

	stats.Revenue, err = getRevenueStats(userIds, startTs, endTs)
	if err != nil {
		return nil, fmt.Errorf("计算付费营收失败: %w", err)
	}

	stats.QuotaHealth, err = getQuotaHealthStats(userIds, startTs, endTs)
	if err != nil {
		return nil, fmt.Errorf("计算积分健康度失败: %w", err)
	}

	stats.Trends, err = getConsumeTrends(userIds, startTs, endTs)
	if err != nil {
		return nil, fmt.Errorf("计算趋势失败: %w", err)
	}

	return stats, nil
}

// getActivityParticipantIds 获取活动参与用户ID列表（时间范围内）
func getActivityParticipantIds(activityId int, startTs, endTs int64) ([]int, error) {
	var userIds []int
	query := DB.Model(&ActivityParticipation{}).
		Where("activity_id = ?", activityId).
		Distinct("user_id")

	if startTs > 0 {
		query = query.Where("participation_time >= ?", time.Unix(startTs, 0))
	}
	if endTs > 0 {
		query = query.Where("participation_time <= ?", time.Unix(endTs, 0))
	}

	err := query.Pluck("user_id", &userIds).Error
	return userIds, err
}

// getAcquisitionStats 拉新与转化
func getAcquisitionStats(userIds []int, startTs, endTs int64) (*AcquisitionStats, error) {
	stats := &AcquisitionStats{}

	// 1. 新注册用户数（时间范围内注册的）
	query := DB.Model(&User{}).Where("id IN ?", userIds)
	if startTs > 0 {
		query = query.Where("created_at >= ?", time.Unix(startTs, 0))
	}
	if endTs > 0 {
		query = query.Where("created_at <= ?", time.Unix(endTs, 0))
	}
	var newUsers int64
	if err := query.Count(&newUsers).Error; err != nil {
		return nil, err
	}
	stats.NewUsers = int(newUsers)

	// 2. 首次消费用户数（注册后有消费记录的）
	if stats.NewUsers > 0 {
		var firstConsumeCount int64
		subQuery := DB.Model(&User{}).Select("id").Where("id IN ?", userIds)
		if startTs > 0 {
			subQuery = subQuery.Where("created_at >= ?", time.Unix(startTs, 0))
		}
		if endTs > 0 {
			subQuery = subQuery.Where("created_at <= ?", time.Unix(endTs, 0))
		}

		err := LOG_DB.Model(&Log{}).
			Where("user_id IN (?)", subQuery).
			Where("type = ?", LogTypeConsume).
			Distinct("user_id").
			Count(&firstConsumeCount).Error
		if err != nil {
			return nil, err
		}
		stats.FirstConsumeUsers = int(firstConsumeCount)
		stats.ConversionRate = float64(firstConsumeCount) / float64(newUsers)
	}

	return stats, nil
}

// getEngagementStats 活跃与留存
func getEngagementStats(userIds []int, startTs, endTs int64) (*EngagementStats, error) {
	stats := &EngagementStats{}
	now := time.Now()

	// DAU/WAU/MAU：LOG_DB 按消费记录去重用户
	baseQuery := LOG_DB.Model(&Log{}).
		Where("user_id IN ?", userIds).
		Where("type = ?", LogTypeConsume)

	// DAU（今天）
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	var dauCount int64
	err := baseQuery.Where("created_at >= ?", todayStart).
		Distinct("user_id").
		Count(&dauCount).Error
	if err != nil {
		return nil, err
	}
	stats.DAU = int(dauCount)

	// WAU（近7天）
	sevenDaysAgo := now.AddDate(0, 0, -7).Unix()
	var wauCount int64
	err = baseQuery.Where("created_at >= ?", sevenDaysAgo).
		Distinct("user_id").
		Count(&wauCount).Error
	if err != nil {
		return nil, err
	}
	stats.WAU = int(wauCount)

	// MAU（近30天）
	thirtyDaysAgo := now.AddDate(0, 0, -30).Unix()
	var mauCount int64
	err = baseQuery.Where("created_at >= ?", thirtyDaysAgo).
		Distinct("user_id").
		Count(&mauCount).Error
	if err != nil {
		return nil, err
	}
	stats.MAU = int(mauCount)

	// 留存率计算（简化版：注册用户中后续有活跃的比例）
	// 次日留存：注册当天算D0，次日（D1）有消费记录
	// 7日留存：注册后7天内有消费记录
	retention1, _ := calculateRetention(userIds, 1)
	retention7, _ := calculateRetention(userIds, 7)
	stats.RetentionDay1 = retention1
	stats.RetentionDay7 = retention7

	return stats, nil
}

// calculateRetention 计算留存率（注册后N天内有活跃的用户占比）
func calculateRetention(userIds []int, days int) (float64, error) {
	if len(userIds) == 0 {
		return 0, nil
	}

	// 获取用户注册时间
	var users []struct {
		Id        int
		CreatedAt time.Time
	}
	if err := DB.Model(&User{}).Select("id, created_at").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return 0, err
	}

	retainedCount := 0
	for _, user := range users {
		retentionStart := user.CreatedAt.AddDate(0, 0, days).Unix()
		retentionEnd := user.CreatedAt.AddDate(0, 0, days+1).Unix()

		var count int64
		err := LOG_DB.Model(&Log{}).
			Where("user_id = ? AND type = ? AND created_at >= ? AND created_at < ?",
				user.Id, LogTypeConsume, retentionStart, retentionEnd).
			Limit(1).
			Count(&count).Error
		if err != nil {
			continue
		}
		if count > 0 {
			retainedCount++
		}
	}

	return float64(retainedCount) / float64(len(users)), nil
}

// getRevenueStats 付费与营收
func getRevenueStats(userIds []int, startTs, endTs int64) (*RevenueStats, error) {
	stats := &RevenueStats{}

	// 1. 总充值额（LogTypeTopup）
	query := LOG_DB.Model(&Log{}).
		Where("user_id IN ? AND type = ?", userIds, LogTypeTopup)

	if startTs > 0 {
		query = query.Where("created_at >= ?", startTs)
	}
	if endTs > 0 {
		query = query.Where("created_at <= ?", endTs)
	}

	var totalRevenue int64
	if err := query.Select("COALESCE(SUM(quota), 0)").Scan(&totalRevenue).Error; err != nil {
		return nil, err
	}
	stats.TotalRevenue = totalRevenue

	// 2. 付费人数
	var payingUsers int64
	queryPaying := LOG_DB.Model(&Log{}).
		Where("user_id IN ? AND type = ?", userIds, LogTypeTopup)
	if startTs > 0 {
		queryPaying = queryPaying.Where("created_at >= ?", startTs)
	}
	if endTs > 0 {
		queryPaying = queryPaying.Where("created_at <= ?", endTs)
	}
	if err := queryPaying.Distinct("user_id").Count(&payingUsers).Error; err != nil {
		return nil, err
	}
	stats.PayingUsers = int(payingUsers)

	// 3. ARPU 与付费率
	if len(userIds) > 0 {
		stats.ARPU = float64(totalRevenue) / float64(len(userIds))
		stats.PayingRate = float64(payingUsers) / float64(len(userIds))
	}

	return stats, nil
}

// getQuotaHealthStats 积分健康度
func getQuotaHealthStats(userIds []int, startTs, endTs int64) (*QuotaHealthStats, error) {
	stats := &QuotaHealthStats{}

	// 1. 总发放（user_timed_quotas.amount）
	queryGrant := DB.Model(&UserTimedQuota{}).Where("user_id IN ?", userIds)
	if startTs > 0 {
		queryGrant = queryGrant.Where("created_at >= ?", time.Unix(startTs, 0))
	}
	if endTs > 0 {
		queryGrant = queryGrant.Where("created_at <= ?", time.Unix(endTs, 0))
	}
	var totalGranted int64
	if err := queryGrant.Select("COALESCE(SUM(amount), 0)").Scan(&totalGranted).Error; err != nil {
		return nil, err
	}
	stats.TotalGranted = totalGranted

	// 2. 总消耗（logs.used_quota, LogTypeConsume）
	queryConsume := LOG_DB.Model(&Log{}).
		Where("user_id IN ? AND type = ?", userIds, LogTypeConsume)
	if startTs > 0 {
		queryConsume = queryConsume.Where("created_at >= ?", startTs)
	}
	if endTs > 0 {
		queryConsume = queryConsume.Where("created_at <= ?", endTs)
	}
	var totalConsumed int64
	if err := queryConsume.Select("COALESCE(SUM(quota), 0)").Scan(&totalConsumed).Error; err != nil {
		return nil, err
	}
	stats.TotalConsumed = totalConsumed

	// 3. 沉淀剩余（user_timed_quotas.remaining）当前快照
	var totalRemaining int64
	if err := DB.Model(&UserTimedQuota{}).
		Where("user_id IN ?", userIds).
		Select("COALESCE(SUM(remaining), 0)").
		Scan(&totalRemaining).Error; err != nil {
		return nil, err
	}
	stats.TotalRemaining = totalRemaining

	// 4. 人均消耗与消耗率
	if len(userIds) > 0 {
		stats.AvgConsumed = float64(totalConsumed) / float64(len(userIds))
	}
	if totalGranted > 0 {
		stats.ConsumptionRate = float64(totalConsumed) / float64(totalGranted)
	}

	return stats, nil
}

// getConsumeTrends 消费趋势（按天分桶）
func getConsumeTrends(userIds []int, startTs, endTs int64) ([]*TrendPoint, error) {
	if len(userIds) == 0 {
		return []*TrendPoint{}, nil
	}

	query := LOG_DB.Model(&Log{}).
		Where("user_id IN ? AND type = ?", userIds, LogTypeConsume)

	if startTs > 0 {
		query = query.Where("created_at >= ?", startTs)
	}
	if endTs > 0 {
		query = query.Where("created_at <= ?", endTs)
	}

	// 按天分组（兼容不同数据库）
	var trends []*TrendPoint
	groupSelect := "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d') as date"
	if DB.Dialector.Name() == "postgres" {
		groupSelect = "TO_CHAR(date_trunc('day', to_timestamp(created_at)), 'YYYY-MM-DD') as date"
	} else if DB.Dialector.Name() == "sqlite" {
		groupSelect = "strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as date"
	}

	err := query.Select(groupSelect + ", COALESCE(SUM(quota), 0) as count").
		Group("date").
		Order("date ASC").
		Scan(&trends).Error

	return trends, err
}
