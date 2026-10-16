package model

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"
)

// ClientEvent 客户端行为事件
type ClientEvent struct {
	Id            int64          `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId        int            `json:"user_id" gorm:"index;not null"`
	Username      string         `json:"username" gorm:"type:varchar(64);index;default:''"`
	EventName     string         `json:"event_name" gorm:"type:varchar(64);index;not null"`
	EventData     string         `json:"event_data" gorm:"type:text"`
	DeviceID      string         `json:"device_id" gorm:"type:varchar(64);index;default:''"`
	ClientVersion string         `json:"client_version" gorm:"type:varchar(32);default:''"`
	Platform      string         `json:"platform" gorm:"type:varchar(32);default:''"`
	OsVersion     string         `json:"os_version" gorm:"type:varchar(64);default:''"`
	Arch          string         `json:"arch" gorm:"type:varchar(32);default:''"`
	CreatedAt     time.Time      `json:"created_at" gorm:"index;autoCreateTime"`
	DeletedAt     gorm.DeletedAt `json:"-" gorm:"index"`
}

func (ClientEvent) TableName() string {
	return "client_events"
}

// dedupKey 生成 UV 去重键:登录用户按 user_id,匿名新数据按 device_id,
// 匿名历史数据(无 device_id)回退按 username(截断8位前缀)近似去重。
// 与 SQL 侧 GetClientEventStats/Trend 的 CASE 表达式保持一致。
func dedupKey(userID int, deviceID, username string) string {
	if userID > 0 {
		return fmt.Sprintf("u:%d", userID)
	}
	if deviceID != "" {
		return "d:" + deviceID
	}
	return "n:" + username
}

// dedupKeySQL 是 dedupKey 的 SQL 等价表达式,用于 COUNT(DISTINCT ...);
// CASE/CONCAT 在 MySQL/PostgreSQL/SQLite 通用,无需分方言。
const dedupKeySQL = `CASE WHEN user_id > 0 THEN CONCAT('u:', user_id) ` +
	`WHEN device_id <> '' THEN CONCAT('d:', device_id) ` +
	`ELSE CONCAT('n:', username) END`

// excludeDownloadBots 给 client_events 查询追加「剔除官网下载点击爬虫行」的条件。
// 爬虫判定见 homepageBotDeviceIDs(同 device_id 在区间内把下载按钮点满 >=3 个平台)。
// 该条件只作用于「官网下载点击」事件行:对其它事件(如首页访问、工具调用)恒为真、
// 不影响计数,因此可安全套用在所有按事件统计/趋势的通用查询上,保证看板 KPI 卡片、
// 折线趋势、细分各处口径一致(都剔除爬虫)。botIDs 为空时不加条件,避免 NOT IN () 的跨库问题。
func excludeDownloadBots(query *gorm.DB, startTime, endTime time.Time) *gorm.DB {
	botIDs := homepageBotDeviceIDs(startTime, endTime)
	if len(botIDs) == 0 {
		return query
	}
	return query.Where("NOT (event_name = ? AND device_id IN ?)", EventHomepageDownload, botIDs)
}

// BatchCreateClientEvents 批量插入事件
func BatchCreateClientEvents(events []ClientEvent) error {
	if len(events) == 0 {
		return nil
	}
	return DB.Create(&events).Error
}

// ClientEventStats 事件统计结果
type ClientEventStats struct {
	EventName   string `json:"event_name" gorm:"column:event_name"`
	Count       int64  `json:"count" gorm:"column:count"`
	UniqueUsers int64  `json:"unique_users" gorm:"column:unique_users"`
}

// ClientEventTrendPoint 事件趋势数据点
type ClientEventTrendPoint struct {
	Date        string `json:"date" gorm:"column:date"`
	EventName   string `json:"event_name" gorm:"column:event_name"`
	Count       int64  `json:"count" gorm:"column:count"`
	UniqueUsers int64  `json:"unique_users" gorm:"column:unique_users"`
}

// GetClientEventStats 获取事件统计
func GetClientEventStats(startTime, endTime time.Time, eventName string, eventNames []string) ([]ClientEventStats, error) {
	var stats []ClientEventStats
	query := DB.Model(&ClientEvent{}).
		Select("event_name, COUNT(*) as count, COUNT(DISTINCT " + dedupKeySQL + ") as unique_users").
		Where("created_at BETWEEN ? AND ?", startTime, endTime)

	if eventName != "" {
		query = query.Where("event_name = ?", eventName)
	} else if len(eventNames) > 0 {
		query = query.Where("event_name IN ?", eventNames)
	}
	query = excludeDownloadBots(query, startTime, endTime)

	err := query.Group("event_name").Order("count DESC").Find(&stats).Error
	return stats, err
}

// GetClientEventTrend 获取事件趋势
func GetClientEventTrend(startTime, endTime time.Time, eventName string, eventNames []string) ([]ClientEventTrendPoint, error) {
	var trend []ClientEventTrendPoint
	query := DB.Model(&ClientEvent{}).
		Select("DATE(created_at) as date, event_name, COUNT(*) as count, COUNT(DISTINCT " + dedupKeySQL + ") as unique_users").
		Where("created_at BETWEEN ? AND ?", startTime, endTime)

	if eventName != "" {
		query = query.Where("event_name = ?", eventName)
	} else if len(eventNames) > 0 {
		query = query.Where("event_name IN ?", eventNames)
	}
	query = excludeDownloadBots(query, startTime, endTime)

	err := query.Group("DATE(created_at), event_name").Order("date ASC").Find(&trend).Error
	return trend, err
}

// sortStatsDesc 按次数降序（细分桶内存聚合后无 SQL 排序，需在 Go 侧排）。
func sortStatsDesc(stats []ClientEventStats) {
	sort.Slice(stats, func(i, j int) bool {
		return stats[i].Count > stats[j].Count
	})
}

// sortTrendByDate 按日期升序，同日期内按次数降序，保证折线 x 轴有序。
func sortTrendByDate(trend []ClientEventTrendPoint) {
	sort.Slice(trend, func(i, j int) bool {
		if trend[i].Date != trend[j].Date {
			return trend[i].Date < trend[j].Date
		}
		return trend[i].Count > trend[j].Count
	})
}

// ClientEventDataKey 某事件 event_data 里一个可选细分字段的元信息。
// Cardinality 为采样内的不同取值数，用于前端启发式判断是否适合细分：
// 低基数（枚举，如 action/type）适合当维度，高基数（name/id/error）不适合。
type ClientEventDataKey struct {
	Key         string   `json:"key"`         // 字段名
	Cardinality int      `json:"cardinality"` // 采样内不同取值数
	Samples     []string `json:"samples"`     // 前若干个样例取值，帮助理解字段含义
}

// GetClientEventDataKeys 采样近一段时间内某事件 event_data 的顶层 JSON key，
// 作为可选的“细分维度”，并统计每个 key 的取值基数与样例值。
// event_data 是任意 JSON 文本，key 事先不定，只能采样后解析。
// 先按 event_data 分组（行数 = 不同取值数，远小于事件量），再在内存解析统计。
func GetClientEventDataKeys(eventName string, since time.Time, sampleGroups int) ([]ClientEventDataKey, error) {
	if eventName == "" {
		return nil, nil
	}
	type dataRow struct {
		EventData string `gorm:"column:event_data"`
	}
	var rows []dataRow
	err := DB.Model(&ClientEvent{}).
		Select("event_data, COUNT(*) as cnt").
		Where("event_name = ? AND created_at >= ? AND event_data <> '' AND event_data <> '{}'", eventName, since).
		Group("event_data").
		Order("cnt DESC").
		Limit(sampleGroups).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	// 每个 key 收集出现过的不同标量取值（有序去重，便于取样例）。
	type keyStat struct {
		values     []string
		valueSeen  map[string]bool
	}
	stats := map[string]*keyStat{}
	order := make([]string, 0, 8) // 保持 key 首次出现顺序
	for _, r := range rows {
		var data map[string]interface{}
		if json.Unmarshal([]byte(r.EventData), &data) != nil {
			continue
		}
		for k, v := range data {
			// 只保留标量取值的 key 作为细分维度（对象/数组无法作为分组桶）
			var sv string
			switch val := v.(type) {
			case string:
				sv = val
			case bool:
				if val {
					sv = "true"
				} else {
					sv = "false"
				}
			case float64:
				if val == float64(int64(val)) {
					sv = fmt.Sprintf("%d", int64(val))
				} else {
					sv = fmt.Sprintf("%v", val)
				}
			case nil:
				sv = ""
			default:
				continue // 对象/数组跳过
			}
			st := stats[k]
			if st == nil {
				st = &keyStat{valueSeen: map[string]bool{}}
				stats[k] = st
				order = append(order, k)
			}
			if sv != "" && !st.valueSeen[sv] {
				st.valueSeen[sv] = true
				st.values = append(st.values, sv)
			}
		}
	}

	const maxSamples = 5
	keys := make([]ClientEventDataKey, 0, len(order))
	for _, k := range order {
		st := stats[k]
		samples := st.values
		if len(samples) > maxSamples {
			samples = samples[:maxSamples]
		}
		keys = append(keys, ClientEventDataKey{
			Key:         k,
			Cardinality: len(st.values),
			Samples:     samples,
		})
	}
	return keys, nil
}

// subdivideRow 细分聚合的 DB 折叠行：某 (日期,) event_data 取值、某用户下的
// 出现次数，用于内存聚合 PV/UV。
type subdivideRow struct {
	Date      string `gorm:"column:date"`
	EventData string `gorm:"column:event_data"`
	UserId    int    `gorm:"column:user_id"`
	DeviceID  string `gorm:"column:device_id"`
	Username  string `gorm:"column:username"`
	Count     int64  `gorm:"column:count"`
}

// bucketOf 从 event_data 解析出指定细分 key 的桶名；缺失或非标量归为“未设置”。
func bucketOf(eventData, key string) string {
	if eventData == "" {
		return "未设置"
	}
	var data map[string]interface{}
	if json.Unmarshal([]byte(eventData), &data) != nil {
		return "未设置"
	}
	v, ok := data[key]
	if !ok || v == nil {
		return "未设置"
	}
	switch val := v.(type) {
	case string:
		if val == "" {
			return "未设置"
		}
		return val
	case bool:
		if val {
			return "true"
		}
		return "false"
	case float64:
		// 整数取值去掉小数尾巴
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%v", val)
	default:
		return "未设置"
	}
}

// GetClientEventStatsSubdivided 按 event_data 中 subdivideKey 的取值细分统计单个事件。
// 沿用 GetHomepageStats 的做法：DB 侧按 (event_data, user_id) 折叠拿到粗行
// （行数与 event_data 取值数 × 活跃用户数相关，远小于原始事件量），
// Go 侧解析 JSON 归桶，PV=sum(count)，UV=distinct user_id（跨 event_data 去重）。
// 结果复用 ClientEventStats，EventName 填成细分取值，前端按其分系列。
func GetClientEventStatsSubdivided(startTime, endTime time.Time, eventName, subdivideKey string) ([]ClientEventStats, error) {
	var rows []subdivideRow
	err := excludeDownloadBots(DB.Model(&ClientEvent{}), startTime, endTime).
		Select("event_data, user_id, device_id, username, COUNT(*) as count").
		Where("event_name = ? AND created_at BETWEEN ? AND ?", eventName, startTime, endTime).
		Group("event_data, user_id, device_id, username").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	countByBucket := map[string]int64{}
	usersByBucket := map[string]map[string]bool{}
	for _, r := range rows {
		b := bucketOf(r.EventData, subdivideKey)
		countByBucket[b] += r.Count
		if usersByBucket[b] == nil {
			usersByBucket[b] = map[string]bool{}
		}
		usersByBucket[b][dedupKey(r.UserId, r.DeviceID, r.Username)] = true
	}

	stats := make([]ClientEventStats, 0, len(countByBucket))
	for bucket, count := range countByBucket {
		stats = append(stats, ClientEventStats{
			EventName:   bucket,
			Count:       count,
			UniqueUsers: int64(len(usersByBucket[bucket])),
		})
	}
	sortStatsDesc(stats)
	return stats, nil
}

// FunnelLayerSpec 漏斗一层的筛选条件:事件 +(可选)event_data 中某字段的确定取值。
// Field 为空表示整事件(不细分)。
type FunnelLayerSpec struct {
	Event string `json:"event"`
	Field string `json:"field"`
	Value string `json:"value"`
}

// FunnelLayerResult 漏斗一层的结果:展示名 + 该层累积交集的去重用户数。
type FunnelLayerResult struct {
	Name  string `json:"name"`
	Users int64  `json:"users"`
}

// funnelLayerName 按 事件·字段=值 生成层展示名;无细分则用事件名。
func funnelLayerName(l FunnelLayerSpec) string {
	if l.Field != "" && l.Value != "" {
		return fmt.Sprintf("%s·%s=%s", l.Event, l.Field, l.Value)
	}
	return l.Event
}

// layerUserSet 取某层在时间区间内满足条件的去重用户集(键为 dedupKey:登录用户/匿名设备)。
// 不细分:按 (user_id,device_id,username) 折叠;细分:再用 bucketOf 过滤。
func layerUserSet(startTime, endTime time.Time, l FunnelLayerSpec) (map[string]bool, error) {
	users := map[string]bool{}
	if l.Field == "" {
		var rows []subdivideRow
		err := DB.Model(&ClientEvent{}).
			Select("user_id, device_id, username, COUNT(*) as count").
			Where("event_name = ? AND created_at BETWEEN ? AND ?", l.Event, startTime, endTime).
			Group("user_id, device_id, username").
			Find(&rows).Error
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			users[dedupKey(r.UserId, r.DeviceID, r.Username)] = true
		}
		return users, nil
	}

	var rows []subdivideRow
	err := DB.Model(&ClientEvent{}).
		Select("event_data, user_id, device_id, username, COUNT(*) as count").
		Where("event_name = ? AND created_at BETWEEN ? AND ?", l.Event, startTime, endTime).
		Group("event_data, user_id, device_id, username").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if bucketOf(r.EventData, l.Field) == l.Value {
			users[dedupKey(r.UserId, r.DeviceID, r.Username)] = true
		}
	}
	return users, nil
}

// GetClientEventFunnel 计算用户维度的逐层转化漏斗:
// 第 N 层 = 同时满足第 1..N 层所有条件的去重用户数(层层求交,必然单调递减)。
// 转化语义是"用户在区间内是否都触发过这些层"(集合求交,非严格时序路径)。
func GetClientEventFunnel(startTime, endTime time.Time, layers []FunnelLayerSpec) ([]FunnelLayerResult, error) {
	results := make([]FunnelLayerResult, 0, len(layers))
	var cumulative map[string]bool // nil 表示尚未进入首层

	for _, layer := range layers {
		layerUsers, err := layerUserSet(startTime, endTime, layer)
		if err != nil {
			return nil, err
		}
		if cumulative == nil {
			cumulative = layerUsers
		} else {
			// 交集:只保留同时在累积集与本层集中的用户
			next := map[string]bool{}
			// 遍历较小的一侧以减少比较
			smaller, larger := cumulative, layerUsers
			if len(layerUsers) < len(cumulative) {
				smaller, larger = layerUsers, cumulative
			}
			for id := range smaller {
				if larger[id] {
					next[id] = true
				}
			}
			cumulative = next
		}
		results = append(results, FunnelLayerResult{
			Name:  funnelLayerName(layer),
			Users: int64(len(cumulative)),
		})
	}
	return results, nil
}

// GetClientEventTrendSubdivided 与上同，但额外按日期分组，用于细分趋势图。
func GetClientEventTrendSubdivided(startTime, endTime time.Time, eventName, subdivideKey string) ([]ClientEventTrendPoint, error) {
	var rows []subdivideRow
	q := DB.Model(&ClientEvent{}).
		Select("DATE(created_at) as date, event_data, user_id, device_id, username, COUNT(*) as count").
		Where("event_name = ? AND created_at BETWEEN ? AND ?", eventName, startTime, endTime)
	q = excludeDownloadBots(q, startTime, endTime)
	err := q.Group("DATE(created_at), event_data, user_id, device_id, username").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	type dayBucket struct {
		date   string
		bucket string
	}
	countByKey := map[dayBucket]int64{}
	usersByKey := map[dayBucket]map[string]bool{}
	for _, r := range rows {
		k := dayBucket{date: r.Date, bucket: bucketOf(r.EventData, subdivideKey)}
		countByKey[k] += r.Count
		if usersByKey[k] == nil {
			usersByKey[k] = map[string]bool{}
		}
		usersByKey[k][dedupKey(r.UserId, r.DeviceID, r.Username)] = true
	}

	trend := make([]ClientEventTrendPoint, 0, len(countByKey))
	for k, count := range countByKey {
		trend = append(trend, ClientEventTrendPoint{
			Date:        k.date,
			EventName:   k.bucket,
			Count:       count,
			UniqueUsers: int64(len(usersByKey[k])),
		})
	}
	sortTrendByDate(trend)
	return trend, nil
}

// GetClientEventNames 返回最近一段时间内出现过的事件名（按出现频次降序）
func GetClientEventNames(since time.Time) ([]string, error) {
	var names []string
	err := DB.Model(&ClientEvent{}).
		Select("event_name").
		Where("created_at >= ?", since).
		Group("event_name").
		Order("COUNT(*) DESC").
		Pluck("event_name", &names).Error
	return names, err
}

// GetClientEventList 获取事件明细列表
func GetClientEventList(startTime, endTime time.Time, eventName string, eventNames []string, username string, offset, limit int) ([]ClientEvent, int64, error) {
	var events []ClientEvent
	var total int64

	query := DB.Model(&ClientEvent{}).Where("created_at BETWEEN ? AND ?", startTime, endTime)

	if eventName != "" {
		query = query.Where("event_name = ?", eventName)
	} else if len(eventNames) > 0 {
		query = query.Where("event_name IN ?", eventNames)
	}
	if username != "" {
		query = query.Where("username LIKE ?", fmt.Sprintf("%%%s%%", username))
	}

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&events).Error
	return events, total, err
}
