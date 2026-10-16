package model

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/helper"
	"gorm.io/gorm"
)

// --- Types ---

type ParvisUserKPI struct {
	NewUsersPeriod   int64   `json:"new_users_period"`
	NewUsersPrev     int64   `json:"new_users_prev"`
	TotalUsers       int64   `json:"total_users"`
	ActiveUsers      int64   `json:"active_users"`
	ActiveUsersPrev  int64   `json:"active_users_prev"`
	NewActiveUsers   int64   `json:"new_active_users"`
	NewActivePrev    int64   `json:"new_active_prev"`
	PaidUsersPeriod  int64   `json:"paid_users_period"`
	PayRate          float64 `json:"pay_rate"`
	OrderCountPeriod int64   `json:"order_count_period"`
	OrderCountTotal  int64   `json:"order_count_total"`
	PaySuccessRate   float64 `json:"pay_success_rate"`
	GmvPeriod        int64   `json:"gmv_period"`
	GmvPrev          int64   `json:"gmv_prev"`
	Arpu             float64 `json:"arpu"`
}

type UserTrendPoint struct {
	Date       string `json:"date" gorm:"column:date"`
	NewUsers   int64  `json:"new_users" gorm:"column:new_users"`
	TotalUsers int64  `json:"total_users"`
}

type RevenueTrendPoint struct {
	Date       string `json:"date" gorm:"column:date"`
	Amount     int64  `json:"amount" gorm:"column:amount"`
	OrderCount int64  `json:"order_count" gorm:"column:order_count"`
}

type UserComposition struct {
	ActivePaid int64 `json:"active_paid"`
	ActiveFree int64 `json:"active_free"`
	Silent     int64 `json:"silent"`
	Churned    int64 `json:"churned"`
}

type PackageDistItem struct {
	Name   string `json:"name" gorm:"column:name"`
	Count  int64  `json:"count" gorm:"column:count"`
	Amount int64  `json:"amount" gorm:"column:amount"`
}

type RetentionTrendPoint struct {
	Date string  `json:"date"`
	D1   float64 `json:"d1"`
	D7   float64 `json:"d7"`
	D30  float64 `json:"d30"`
}

type ConversionFunnel struct {
	Registered   int64 `json:"registered"`
	FirstRequest int64 `json:"first_request"`
	FirstPaid    int64 `json:"first_paid"`
}

type PayTypeDistItem struct {
	PayType string `json:"pay_type" gorm:"column:pay_type"`
	Count   int64  `json:"count" gorm:"column:count"`
	Amount  int64  `json:"amount" gorm:"column:amount"`
}

type BillingCycleDistItem struct {
	BillingCycle string `json:"billing_cycle" gorm:"column:billing_cycle"`
	Count        int64  `json:"count" gorm:"column:count"`
	Amount       int64  `json:"amount" gorm:"column:amount"`
}

type RecentOrderItem struct {
	OrderNo     string     `json:"order_no" gorm:"column:order_no"`
	Username    string     `json:"username" gorm:"column:username"`
	PackageName string     `json:"package_name" gorm:"column:package_name"`
	Amount      int64      `json:"amount" gorm:"column:amount"`
	PayType     string     `json:"pay_type" gorm:"column:pay_type"`
	Status      string     `json:"status" gorm:"column:status"`
	CreatedAt   time.Time  `json:"created_at" gorm:"column:created_at"`
	PaidAt      *time.Time `json:"paid_at" gorm:"column:paid_at"`
}

type OrderStatusDistItem struct {
	Status string `json:"status" gorm:"column:status"`
	Count  int64  `json:"count" gorm:"column:count"`
}

type TopSpender struct {
	UserId      int    `json:"user_id" gorm:"column:user_id"`
	Username    string `json:"username" gorm:"column:username"`
	OrderCount  int64  `json:"order_count" gorm:"column:order_count"`
	TotalAmount int64  `json:"total_amount" gorm:"column:total_amount"`
}

// --- SQL helpers ---

func dateFormatSQL(alias string) string {
	if common.UsingPostgreSQL {
		return fmt.Sprintf("TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as %s", alias)
	}
	if common.UsingSQLite {
		return fmt.Sprintf("strftime('%%Y-%%m-%%d', created_at) as %s", alias)
	}
	return fmt.Sprintf("DATE_FORMAT(created_at, '%%Y-%%m-%%d') as %s", alias)
}

func orderDateFormatSQL(field, alias string) string {
	if common.UsingPostgreSQL {
		return fmt.Sprintf("TO_CHAR(DATE(%s), 'YYYY-MM-DD') as %s", field, alias)
	}
	if common.UsingSQLite {
		return fmt.Sprintf("strftime('%%Y-%%m-%%d', %s) as %s", field, alias)
	}
	return fmt.Sprintf("DATE_FORMAT(%s, '%%Y-%%m-%%d') as %s", field, alias)
}

func ifnullSQL() string {
	if common.UsingPostgreSQL {
		return "COALESCE"
	}
	return "IFNULL"
}

// --- Query functions ---

func GetParvisUserKPI(startTime, endTime time.Time) (*ParvisUserKPI, error) {
	kpi := &ParvisUserKPI{}
	fn := ifnullSQL()

	duration := endTime.Sub(startTime)
	prevStart := startTime.Add(-duration)
	prevEnd := startTime.Add(-time.Second)

	DB.Model(&User{}).Where("created_at BETWEEN ? AND ?", startTime, endTime).Count(&kpi.NewUsersPeriod)
	DB.Model(&User{}).Where("created_at BETWEEN ? AND ?", prevStart, prevEnd).Count(&kpi.NewUsersPrev)
	DB.Model(&User{}).Count(&kpi.TotalUsers)
	LOG_DB.Model(&Log{}).Where("type = ? AND created_at BETWEEN ? AND ?", LogTypeConsume, startTime.Unix(), endTime.Unix()).
		Select("COUNT(DISTINCT user_id)").Scan(&kpi.ActiveUsers)
	LOG_DB.Model(&Log{}).Where("type = ? AND created_at BETWEEN ? AND ?", LogTypeConsume, prevStart.Unix(), prevEnd.Unix()).
		Select("COUNT(DISTINCT user_id)").Scan(&kpi.ActiveUsersPrev)

	kpi.NewActiveUsers = countNewActiveUsers(startTime, endTime)
	kpi.NewActivePrev = countNewActiveUsers(prevStart, prevEnd)

	DB.Model(&Order{}).Where("status = ? AND paid_at BETWEEN ? AND ?", OrderStatusPaid, startTime, endTime).
		Select("COUNT(DISTINCT user_id)").Scan(&kpi.PaidUsersPeriod)
	if kpi.TotalUsers > 0 {
		kpi.PayRate = float64(kpi.PaidUsersPeriod) / float64(kpi.TotalUsers)
	}

	DB.Model(&Order{}).Where("status = ? AND paid_at BETWEEN ? AND ?", OrderStatusPaid, startTime, endTime).
		Count(&kpi.OrderCountPeriod)
	DB.Model(&Order{}).Where("created_at BETWEEN ? AND ?", startTime, endTime).
		Count(&kpi.OrderCountTotal)
	if kpi.OrderCountTotal > 0 {
		kpi.PaySuccessRate = float64(kpi.OrderCountPeriod) / float64(kpi.OrderCountTotal)
	}

	DB.Model(&Order{}).Where("status = ? AND paid_at BETWEEN ? AND ?", OrderStatusPaid, startTime, endTime).
		Select(fmt.Sprintf("%s(SUM(amount), 0)", fn)).Scan(&kpi.GmvPeriod)
	DB.Model(&Order{}).Where("status = ? AND paid_at BETWEEN ? AND ?", OrderStatusPaid, prevStart, prevEnd).
		Select(fmt.Sprintf("%s(SUM(amount), 0)", fn)).Scan(&kpi.GmvPrev)

	if kpi.PaidUsersPeriod > 0 {
		kpi.Arpu = float64(kpi.GmvPeriod) / float64(kpi.PaidUsersPeriod)
	}

	return kpi, nil
}

// countNewActiveUsers 统计在 [startTime, endTime] 内注册、且在同一区间内有实际消费调用的去重用户数。
// 用户表与日志表分属不同数据库，先取新增用户 ID，再去日志库统计其中有调用的人数。
func countNewActiveUsers(startTime, endTime time.Time) int64 {
	var newUserIds []int
	DB.Model(&User{}).Where("created_at BETWEEN ? AND ?", startTime, endTime).
		Pluck("id", &newUserIds)
	if len(newUserIds) == 0 {
		return 0
	}

	var count int64
	LOG_DB.Model(&Log{}).
		Where("type = ? AND created_at BETWEEN ? AND ? AND user_id IN ?",
			LogTypeConsume, startTime.Unix(), endTime.Unix(), newUserIds).
		Select("COUNT(DISTINCT user_id)").Scan(&count)
	return count
}

func GetUserGrowthTrend(startTime, endTime time.Time) ([]*UserTrendPoint, error) {
	var points []*UserTrendPoint
	groupSelect := dateFormatSQL("date")

	err := DB.Model(&User{}).
		Select(groupSelect+", COUNT(*) as new_users").
		Where("created_at BETWEEN ? AND ?", startTime, endTime).
		Group("date").Order("date").
		Find(&points).Error
	if err != nil {
		return nil, err
	}

	var runningTotal int64
	DB.Model(&User{}).Where("created_at < ?", startTime).Count(&runningTotal)
	for _, p := range points {
		runningTotal += p.NewUsers
		p.TotalUsers = runningTotal
	}
	return points, nil
}

func GetRevenueTrend(startTime, endTime time.Time) ([]*RevenueTrendPoint, error) {
	var points []*RevenueTrendPoint
	groupSelect := orderDateFormatSQL("paid_at", "date")
	fn := ifnullSQL()

	err := DB.Model(&Order{}).
		Select(groupSelect+fmt.Sprintf(", %s(SUM(amount), 0) as amount, COUNT(*) as order_count", fn)).
		Where("status = ? AND paid_at BETWEEN ? AND ?", OrderStatusPaid, startTime, endTime).
		Group("date").Order("date").
		Find(&points).Error
	return points, err
}

func GetUserComposition() (*UserComposition, error) {
	comp := &UserComposition{}
	now := helper.GetTimestamp()
	day7 := now - 7*86400
	day30 := now - 30*86400

	var activeUserIds []int
	LOG_DB.Table("logs").Where("type = ? AND created_at >= ?", LogTypeConsume, day7).
		Select("DISTINCT user_id").Pluck("user_id", &activeUserIds)
	activeSet := make(map[int]bool, len(activeUserIds))
	for _, id := range activeUserIds {
		activeSet[id] = true
	}

	var subUserIds []int
	DB.Model(&Subscription{}).Where("status = ?", "active").
		Select("DISTINCT user_id").Pluck("user_id", &subUserIds)
	subSet := make(map[int]bool, len(subUserIds))
	for _, id := range subUserIds {
		subSet[id] = true
	}

	var silentUserIds []int
	LOG_DB.Raw(`
		SELECT DISTINCT user_id FROM logs
		WHERE type = ? AND created_at BETWEEN ? AND ?
		AND user_id NOT IN (
			SELECT DISTINCT user_id FROM logs WHERE type = ? AND created_at >= ?
		)
	`, LogTypeConsume, day30, day7, LogTypeConsume, day7).Pluck("user_id", &silentUserIds)

	for _, id := range activeUserIds {
		if subSet[id] {
			comp.ActivePaid++
		} else {
			comp.ActiveFree++
		}
	}
	comp.Silent = int64(len(silentUserIds))

	var totalUsers int64
	DB.Model(&User{}).Count(&totalUsers)
	comp.Churned = totalUsers - int64(len(activeUserIds)) - comp.Silent

	if comp.Churned < 0 {
		comp.Churned = 0
	}
	return comp, nil
}

func GetPackageDistribution(startTime, endTime time.Time) ([]*PackageDistItem, error) {
	var items []*PackageDistItem
	fn := ifnullSQL()

	err := DB.Model(&Order{}).
		Select(fmt.Sprintf("package_name as name, COUNT(*) as count, %s(SUM(amount), 0) as amount", fn)).
		Where("created_at BETWEEN ? AND ?", startTime, endTime).
		Group("package_name").Order("count DESC").
		Find(&items).Error
	return items, err
}

func GetConversionFunnel(startTime, endTime time.Time) (*ConversionFunnel, error) {
	funnel := &ConversionFunnel{}
	startTs := startTime.Unix()

	DB.Model(&User{}).Where("created_at BETWEEN ? AND ?", startTime, endTime).Count(&funnel.Registered)

	if funnel.Registered == 0 {
		return funnel, nil
	}

	DB.Raw(`
		SELECT COUNT(DISTINCT u.id) FROM users u
		INNER JOIN (SELECT DISTINCT user_id FROM logs WHERE type = ? AND created_at >= ?) l
		ON u.id = l.user_id
		WHERE u.created_at BETWEEN ? AND ?
	`, LogTypeConsume, startTs, startTime, endTime).Scan(&funnel.FirstRequest)

	DB.Raw(`
		SELECT COUNT(DISTINCT u.id) FROM users u
		INNER JOIN (SELECT DISTINCT user_id FROM orders WHERE status = ?) o
		ON u.id = o.user_id
		WHERE u.created_at BETWEEN ? AND ?
	`, OrderStatusPaid, startTime, endTime).Scan(&funnel.FirstPaid)

	return funnel, nil
}

func calcRetentionForDay(baseDate time.Time, dayOffset int) float64 {
	dayStart := baseDate.Truncate(24 * time.Hour)
	dayEnd := dayStart.Add(24*time.Hour - time.Second)
	startTs := dayStart.Unix()
	endTs := dayEnd.Unix()

	targetStart := dayStart.AddDate(0, 0, dayOffset)
	targetEnd := targetStart.Add(24*time.Hour - time.Second)
	targetStartTs := targetStart.Unix()
	targetEndTs := targetEnd.Unix()

	var registered int64
	LOG_DB.Table("logs").Where("type = ? AND created_at BETWEEN ? AND ?", LogTypeConsume, startTs, endTs).
		Select("COUNT(DISTINCT user_id)").Scan(&registered)
	if registered == 0 {
		return 0
	}

	var returned int64
	LOG_DB.Raw(`
		SELECT COUNT(DISTINCT a.user_id) FROM
		(SELECT DISTINCT user_id FROM logs WHERE type = ? AND created_at BETWEEN ? AND ?) a
		INNER JOIN
		(SELECT DISTINCT user_id FROM logs WHERE type = ? AND created_at BETWEEN ? AND ?) b
		ON a.user_id = b.user_id
	`, LogTypeConsume, startTs, endTs, LogTypeConsume, targetStartTs, targetEndTs).Scan(&returned)

	return float64(returned) / float64(registered)
}

func GetRetentionTrend(days int) ([]*RetentionTrendPoint, error) {
	var points []*RetentionTrendPoint
	now := time.Now()

	for i := days; i >= 1; i-- {
		baseDate := now.AddDate(0, 0, -i-30)
		point := &RetentionTrendPoint{
			Date: now.AddDate(0, 0, -i).Format("2006-01-02"),
		}

		d1Base := now.AddDate(0, 0, -i-1)
		point.D1 = calcRetentionForDay(d1Base, 1)

		d7Base := now.AddDate(0, 0, -i-7)
		point.D7 = calcRetentionForDay(d7Base, 7)

		point.D30 = calcRetentionForDay(baseDate, 30)

		points = append(points, point)
	}
	return points, nil
}

func GetPayTypeDistribution(startTime, endTime time.Time) ([]*PayTypeDistItem, error) {
	var items []*PayTypeDistItem
	fn := ifnullSQL()

	err := DB.Model(&Order{}).
		Select(fmt.Sprintf("pay_type, COUNT(*) as count, %s(SUM(amount), 0) as amount", fn)).
		Where("created_at BETWEEN ? AND ?", startTime, endTime).
		Group("pay_type").
		Find(&items).Error
	return items, err
}

func GetBillingCycleDistribution(startTime, endTime time.Time) ([]*BillingCycleDistItem, error) {
	var items []*BillingCycleDistItem
	fn := ifnullSQL()

	err := DB.Model(&Order{}).
		Select(fmt.Sprintf("billing_cycle, COUNT(*) as count, %s(SUM(amount), 0) as amount", fn)).
		Where("status = ? AND paid_at BETWEEN ? AND ?", OrderStatusPaid, startTime, endTime).
		Group("billing_cycle").
		Find(&items).Error
	return items, err
}

func GetOrderStatusDistribution(startTime, endTime time.Time) ([]*OrderStatusDistItem, error) {
	var items []*OrderStatusDistItem
	err := DB.Model(&Order{}).
		Select("status, COUNT(*) as count").
		Where("created_at BETWEEN ? AND ?", startTime, endTime).
		Group("status").
		Find(&items).Error
	return items, err
}

func GetRecentOrders(limit int) ([]*RecentOrderItem, error) {
	var items []*RecentOrderItem
	err := DB.Model(&Order{}).
		Select("order_no, username, package_name, amount, pay_type, status, created_at, paid_at").
		Order("created_at DESC").
		Limit(limit).
		Find(&items).Error
	return items, err
}

func GetTopSpenders(startTime, endTime time.Time, limit int) ([]*TopSpender, error) {
	var items []*TopSpender
	fn := ifnullSQL()
	err := DB.Model(&Order{}).
		Select(fmt.Sprintf("user_id, username, COUNT(*) as order_count, %s(SUM(amount), 0) as total_amount", fn)).
		Where("status = ? AND paid_at BETWEEN ? AND ?", OrderStatusPaid, startTime, endTime).
		Group("user_id, username").
		Order("total_amount DESC").
		Limit(limit).
		Find(&items).Error
	return items, err
}

// 官网首页埋点事件名 —— 与 www/homepage 前端上报、
// web/air/src/constants/clientEvents.js 中的定义保持一致。
const (
	EventHomepageVisit    = "官网首页访问"
	EventHomepageDownload = "官网下载点击"
)

// PlatformDownloadItem 单个平台的下载点击数
type PlatformDownloadItem struct {
	Platform string `json:"platform"`
	Count    int64  `json:"count"`
}

// HomepageStats 官网首页埋点统计
type HomepageStats struct {
	VisitCount      int64                  `json:"visit_count"`       // 首页访问 PV（事件次数）
	VisitDevices    int64                  `json:"visit_devices"`     // 首页访问 UV（去重设备）
	DownloadCount   int64                  `json:"download_count"`    // 下载点击总数
	DownloadDevices int64                  `json:"download_devices"`  // 点击下载的去重设备数
	PlatformDist    []PlatformDownloadItem `json:"platform_dist"`     // 各平台下载点击数
}

// botPlatformThreshold 爬虫判定阈值：同一 device_id 在统计区间内对官网下载点击
// 覆盖的不同平台数达到该值即判为爬虫。真人几乎不会在同一区间把 Mac ARM/Mac Intel/
// Windows 三个安装包挨个点一遍，而爬虫/扫描器会把页面上所有下载链接顺序点全。
const botPlatformThreshold = 3

// homepageBotDeviceIDs 找出下载点击疑似爬虫的 device_id 列表。
// 判定：非空 device_id 在区间内触发「官网下载点击」覆盖的不同 event_data（即平台）
// 数量 >= botPlatformThreshold。行数 = 爬虫设备数（通常数十个内），可安全拉进内存。
func homepageBotDeviceIDs(startTime, endTime time.Time) []string {
	var ids []string
	DB.Model(&ClientEvent{}).
		Where("event_name = ? AND created_at BETWEEN ? AND ? AND device_id <> ''", EventHomepageDownload, startTime, endTime).
		Group("device_id").
		Having("COUNT(DISTINCT event_data) >= ?", botPlatformThreshold).
		Pluck("device_id", &ids)
	return ids
}

// excludeBots 给下载点击查询追加「排除爬虫 device_id」条件；列表为空时不加，
// 避免 NOT IN () 在部分数据库上的语法/语义问题。
func excludeBots(db *gorm.DB, botIDs []string) *gorm.DB {
	if len(botIDs) == 0 {
		return db
	}
	return db.Where("device_id NOT IN ?", botIDs)
}

// GetHomepageStats 统计官网首页访问与下载点击。
// client_events 与 User 同库，使用 DB 句柄。
// 下载点击的平台维度存在 event_data 中（固定为 {"type":"xxx"} 这种少数取值），
// 用 GROUP BY event_data 在数据库侧聚合，结果至多几行、与点击量级无关，
// 避免把全部明细拉进内存；GROUP BY 普通文本列三种数据库均支持，无 JSON 方言问题。
// 下载点击口径会剔除爬虫设备（见 homepageBotDeviceIDs），避免扫描器把三个平台
// 按钮顺序点全导致 PV 虚高；首页访问 PV/UV 不做此过滤（本就按 session 去重）。
func GetHomepageStats(startTime, endTime time.Time) (*HomepageStats, error) {
	stats := &HomepageStats{}

	DB.Model(&ClientEvent{}).
		Where("event_name = ? AND created_at BETWEEN ? AND ?", EventHomepageVisit, startTime, endTime).
		Count(&stats.VisitCount)
	DB.Model(&ClientEvent{}).
		Where("event_name = ? AND created_at BETWEEN ? AND ?", EventHomepageVisit, startTime, endTime).
		Select("COUNT(DISTINCT username)").Scan(&stats.VisitDevices)

	botIDs := homepageBotDeviceIDs(startTime, endTime)

	excludeBots(DB.Model(&ClientEvent{}), botIDs).
		Where("event_name = ? AND created_at BETWEEN ? AND ?", EventHomepageDownload, startTime, endTime).
		Count(&stats.DownloadCount)
	excludeBots(DB.Model(&ClientEvent{}), botIDs).
		Where("event_name = ? AND created_at BETWEEN ? AND ?", EventHomepageDownload, startTime, endTime).
		Select("COUNT(DISTINCT username)").Scan(&stats.DownloadDevices)

	// 按 event_data 分组聚合，行数 = 不同平台取值数（极少），与点击量无关。
	type downloadGroup struct {
		EventData string `gorm:"column:event_data"`
		Count     int64  `gorm:"column:count"`
	}
	var groups []downloadGroup
	excludeBots(DB.Model(&ClientEvent{}), botIDs).
		Select("event_data, COUNT(*) as count").
		Where("event_name = ? AND created_at BETWEEN ? AND ?", EventHomepageDownload, startTime, endTime).
		Group("event_data").
		Find(&groups)

	// 不同 event_data 可能解析出同一平台（如缺字段统一归为 unknown），在内存合并。
	platformCounts := map[string]int64{}
	for _, g := range groups {
		platform := "unknown"
		if g.EventData != "" {
			var data map[string]interface{}
			if err := json.Unmarshal([]byte(g.EventData), &data); err == nil {
				if t, ok := data["type"].(string); ok && t != "" {
					platform = t
				}
			}
		}
		platformCounts[platform] += g.Count
	}

	for platform, count := range platformCounts {
		stats.PlatformDist = append(stats.PlatformDist, PlatformDownloadItem{Platform: platform, Count: count})
	}
	sort.Slice(stats.PlatformDist, func(i, j int) bool {
		return stats.PlatformDist[i].Count > stats.PlatformDist[j].Count
	})

	return stats, nil
}

// DeviceDistItem 设备/版本维度的分布项，Name 为维度取值，Count 为去重用户数。
type DeviceDistItem struct {
	Name  string `json:"name" gorm:"column:name"`
	Count int64  `json:"count" gorm:"column:count"`
}

// DeviceStats 活跃用户的设备与版本分布。
// 口径：client_events 上报记录，按 user_id 去重，排除匿名事件（user_id=0）。
type DeviceStats struct {
	VersionDist  []DeviceDistItem `json:"version_dist"`  // 客户端版本分布
	PlatformDist []DeviceDistItem `json:"platform_dist"` // 平台分布
	OsDist       []DeviceDistItem `json:"os_dist"`       // 系统版本分布
	ArchDist     []DeviceDistItem `json:"arch_dist"`     // 架构分布
	TotalUsers   int64            `json:"total_users"`   // 区间内有上报的去重用户数
}

// deviceDistByColumn 按指定列分组统计去重用户数，排除匿名（user_id=0）与空值。
// client_events 与 User 同库，使用 DB 句柄；分组列基数极低（版本/平台/架构），
// 结果至多数十行，与事件量无关。
func deviceDistByColumn(column string, startTime, endTime time.Time) ([]DeviceDistItem, error) {
	var items []DeviceDistItem
	err := DB.Model(&ClientEvent{}).
		Select(column+" as name, COUNT(DISTINCT user_id) as count").
		Where("created_at BETWEEN ? AND ? AND user_id > 0 AND "+column+" <> ''", startTime, endTime).
		Group(column).
		Order("count DESC").
		Find(&items).Error
	return items, err
}

// GetDeviceStats 统计活跃用户的设备/版本分布（client_events 口径，去重 user_id，排除匿名）。
func GetDeviceStats(startTime, endTime time.Time) (*DeviceStats, error) {
	stats := &DeviceStats{}
	var err error

	if stats.VersionDist, err = deviceDistByColumn("client_version", startTime, endTime); err != nil {
		return nil, err
	}
	if stats.PlatformDist, err = deviceDistByColumn("platform", startTime, endTime); err != nil {
		return nil, err
	}
	if stats.OsDist, err = deviceDistByColumn("os_version", startTime, endTime); err != nil {
		return nil, err
	}
	if stats.ArchDist, err = deviceDistByColumn("arch", startTime, endTime); err != nil {
		return nil, err
	}

	DB.Model(&ClientEvent{}).
		Where("created_at BETWEEN ? AND ? AND user_id > 0", startTime, endTime).
		Select("COUNT(DISTINCT user_id)").Scan(&stats.TotalUsers)

	return stats, nil
}

// VersionUsageItem 单个客户端版本对应的活跃用户数
type VersionUsageItem struct {
	Version string `json:"version"`
	Users   int64  `json:"users"`
}

// GetActiveUserVersionDist 统计活跃用户当前实际使用的客户端版本分布。
// “活跃用户”与 KPI 一致：选定时间内有实际消费调用的去重用户。
// 活跃用户 ID 来自日志库（LOG_DB），客户端版本来自 client_events（DB，与 User 同库），
// 两表分属不同库，沿用 countNewActiveUsers 的做法：先取活跃用户 ID，再到事件表取其上报版本。
// 同一用户在区间内可能升级过版本，按上报时间倒序取“最近一次”作为其实际使用版本；
// 活跃但从未上报版本的用户归入“未知”，使各版本人数之和等于活跃用户总数。
func GetActiveUserVersionDist(startTime, endTime time.Time) ([]*VersionUsageItem, error) {
	var activeUserIds []int
	LOG_DB.Model(&Log{}).
		Where("type = ? AND created_at BETWEEN ? AND ?", LogTypeConsume, startTime.Unix(), endTime.Unix()).
		Select("DISTINCT user_id").Pluck("user_id", &activeUserIds)
	if len(activeUserIds) == 0 {
		return []*VersionUsageItem{}, nil
	}

	type versionRow struct {
		UserId        int       `gorm:"column:user_id"`
		ClientVersion string    `gorm:"column:client_version"`
		CreatedAt     time.Time `gorm:"column:created_at"`
	}
	var rows []versionRow
	DB.Model(&ClientEvent{}).
		Select("user_id, client_version, created_at").
		Where("user_id IN ? AND client_version != '' AND created_at BETWEEN ? AND ?",
			activeUserIds, startTime, endTime).
		Order("created_at DESC").
		Find(&rows)

	// created_at 倒序：每个用户首次出现即其最近一次上报的版本。
	latest := make(map[int]string, len(activeUserIds))
	for _, r := range rows {
		if _, ok := latest[r.UserId]; !ok {
			latest[r.UserId] = r.ClientVersion
		}
	}

	versionCounts := map[string]int64{}
	for _, v := range latest {
		versionCounts[v]++
	}

	items := make([]*VersionUsageItem, 0, len(versionCounts)+1)
	for version, users := range versionCounts {
		items = append(items, &VersionUsageItem{Version: version, Users: users})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Users > items[j].Users
	})

	// 活跃但从未上报版本的用户归入“未知”，置于末尾。
	if unknown := int64(len(activeUserIds)) - int64(len(latest)); unknown > 0 {
		items = append(items, &VersionUsageItem{Version: "未知", Users: unknown})
	}

	return items, nil
}
