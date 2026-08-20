package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
)

func setupFunnelTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&ClientEvent{}))
	DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
}

// 构造事件:用户 uid 在 now 触发一次 event(带 event_data)。
func seedEvent(t *testing.T, uid int, event, data string) {
	require.NoError(t, DB.Create(&ClientEvent{
		UserId:    uid,
		EventName: event,
		EventData: data,
		CreatedAt: time.Now(),
	}).Error)
}

// 构造匿名事件:user_id=0,按 device_id 区分设备。
func seedAnonEvent(t *testing.T, deviceID, event, data string) {
	require.NoError(t, DB.Create(&ClientEvent{
		UserId:    0,
		DeviceID:  deviceID,
		Username:  "未登录设备:" + deviceID,
		EventName: event,
		EventData: data,
		CreatedAt: time.Now(),
	}).Error)
}

func TestGetClientEventFunnel(t *testing.T) {
	setupFunnelTestDB(t)

	// 场景:
	// 用户 1,2,3 都触发过"工具调用"(整体)
	// 其中 1,2 触发过 tool=skill;只有 1 触发过 tool=bash
	seedEvent(t, 1, "工具调用", `{"tool":"skill"}`)
	seedEvent(t, 1, "工具调用", `{"tool":"bash"}`)
	seedEvent(t, 2, "工具调用", `{"tool":"skill"}`)
	seedEvent(t, 3, "工具调用", `{"tool":"read"}`)

	start := time.Now().AddDate(0, 0, -1)
	end := time.Now().Add(time.Hour)

	layers := []FunnelLayerSpec{
		{Event: "工具调用"},                            // 层1:整体 → 用户 {1,2,3} = 3
		{Event: "工具调用", Field: "tool", Value: "skill"}, // 层2:且 tool=skill → {1,2} = 2
		{Event: "工具调用", Field: "tool", Value: "bash"},  // 层3:且 tool=bash → {1} = 1
	}

	res, err := GetClientEventFunnel(start, end, layers)
	require.NoError(t, err)
	require.Len(t, res, 3)

	// 逐层收窄
	assert.Equal(t, int64(3), res[0].Users, "层1 整体应为 3 个用户")
	assert.Equal(t, int64(2), res[1].Users, "层2 交集 tool=skill 应为 2")
	assert.Equal(t, int64(1), res[2].Users, "层3 再交 tool=bash 应为 1")

	// 单调递减(漏斗核心不变量:下层 ≤ 上层)
	for i := 1; i < len(res); i++ {
		assert.LessOrEqual(t, res[i].Users, res[i-1].Users, "第 %d 层不应超过上一层", i+1)
	}

	// 层名生成
	assert.Equal(t, "工具调用", res[0].Name)
	assert.Equal(t, "工具调用·tool=skill", res[1].Name)
}

func TestGetClientEventFunnelEmpty(t *testing.T) {
	setupFunnelTestDB(t)
	start := time.Now().AddDate(0, 0, -1)
	end := time.Now().Add(time.Hour)

	res, err := GetClientEventFunnel(start, end, nil)
	require.NoError(t, err)
	assert.Len(t, res, 0)
}

// 匿名事件按 device_id 去重:3 台设备访问首页,2 台点下载 → 漏斗 3→2。
// 同一设备重复触发不重复计数。验证 user_id 全为 0 时仍能正确区分设备。
func TestGetClientEventFunnelAnonymous(t *testing.T) {
	setupFunnelTestDB(t)

	seedAnonEvent(t, "dev-A", "官网首页访问", "")
	seedAnonEvent(t, "dev-A", "官网首页访问", "") // 同设备重复,不应多计
	seedAnonEvent(t, "dev-B", "官网首页访问", "")
	seedAnonEvent(t, "dev-C", "官网首页访问", "")
	seedAnonEvent(t, "dev-A", "官网下载点击", "")
	seedAnonEvent(t, "dev-B", "官网下载点击", "")

	start := time.Now().AddDate(0, 0, -1)
	end := time.Now().Add(time.Hour)

	res, err := GetClientEventFunnel(start, end, []FunnelLayerSpec{
		{Event: "官网首页访问"},
		{Event: "官网下载点击"},
	})
	require.NoError(t, err)
	require.Len(t, res, 2)
	assert.Equal(t, int64(3), res[0].Users, "3 台设备访问首页")
	assert.Equal(t, int64(2), res[1].Users, "其中 2 台又点了下载")
}

// 官网下载点击爬虫过滤:同一设备把 3 个平台按钮顺序点全 → 判为爬虫整体剔除;
// 真人只点单个平台(可重复点)不受影响。验证 PV/UV/平台分布三处口径一致过滤。
func TestGetHomepageStatsBotFilter(t *testing.T) {
	setupFunnelTestDB(t)

	// 爬虫 bot-1:一次点满 mac-arm/mac-intel/windows 三平台 → 应整体剔除(贡献 0)
	seedAnonEvent(t, "bot-1", EventHomepageDownload, `{"type":"mac-arm"}`)
	seedAnonEvent(t, "bot-1", EventHomepageDownload, `{"type":"mac-intel"}`)
	seedAnonEvent(t, "bot-1", EventHomepageDownload, `{"type":"windows"}`)
	// 真人 human-1:只点 windows,重试点了两次 → 保留,记 2 次 PV / 1 台
	seedAnonEvent(t, "human-1", EventHomepageDownload, `{"type":"windows"}`)
	seedAnonEvent(t, "human-1", EventHomepageDownload, `{"type":"windows"}`)
	// 真人 human-2:点了 mac-arm 又切 mac-intel(2 平台,未达阈值) → 保留,记 2 次 PV / 1 台
	seedAnonEvent(t, "human-2", EventHomepageDownload, `{"type":"mac-arm"}`)
	seedAnonEvent(t, "human-2", EventHomepageDownload, `{"type":"mac-intel"}`)

	start := time.Now().AddDate(0, 0, -1)
	end := time.Now().Add(time.Hour)

	stats, err := GetHomepageStats(start, end)
	require.NoError(t, err)

	// bot-1 的 3 次被剔除,剩 human-1(2) + human-2(2) = 4 次 PV
	assert.Equal(t, int64(4), stats.DownloadCount, "下载 PV 应剔除爬虫 3 次")
	// 去重设备:human-1、human-2 两台(bot-1 整体剔除)
	assert.Equal(t, int64(2), stats.DownloadDevices, "下载 UV 应剔除爬虫设备")

	// 平台分布:windows=2(human-1) / mac-arm=1(human-2) / mac-intel=1(human-2),bot 的不计入
	dist := map[string]int64{}
	for _, item := range stats.PlatformDist {
		dist[item.Platform] = item.Count
	}
	assert.Equal(t, int64(2), dist["windows"], "windows 仅剩真人 2 次")
	assert.Equal(t, int64(1), dist["mac-arm"], "mac-arm 仅剩真人 1 次")
	assert.Equal(t, int64(1), dist["mac-intel"], "mac-intel 仅剩真人 1 次")
}

// 无爬虫时不应误伤:所有设备都只点单平台,DownloadCount 全额保留。
// 兼带验证 excludeBots 在爬虫列表为空时不会生成 NOT IN () 破坏查询。
func TestGetHomepageStatsNoBots(t *testing.T) {
	setupFunnelTestDB(t)

	seedAnonEvent(t, "dev-A", EventHomepageDownload, `{"type":"windows"}`)
	seedAnonEvent(t, "dev-B", EventHomepageDownload, `{"type":"mac-arm"}`)
	seedAnonEvent(t, "dev-B", EventHomepageDownload, `{"type":"mac-arm"}`)

	start := time.Now().AddDate(0, 0, -1)
	end := time.Now().Add(time.Hour)

	stats, err := GetHomepageStats(start, end)
	require.NoError(t, err)
	assert.Equal(t, int64(3), stats.DownloadCount, "无爬虫时 PV 全额保留")
	assert.Equal(t, int64(2), stats.DownloadDevices, "两台真人设备")
}

// 通用统计/趋势接口(看板折线图与总量卡片共用)也须剔除下载爬虫,且不误伤其它事件。
// 场景:bot-1 点满三平台(爬虫)、human-1 只点 windows;两台设备都各访问首页一次。
func TestGetClientEventStatsExcludesDownloadBots(t *testing.T) {
	setupFunnelTestDB(t)

	// bot-1:同设备点满 3 平台 → 判为爬虫,下载点击应被剔除
	seedAnonEvent(t, "bot-1", EventHomepageDownload, `{"type":"windows"}`)
	seedAnonEvent(t, "bot-1", EventHomepageDownload, `{"type":"mac-arm"}`)
	seedAnonEvent(t, "bot-1", EventHomepageDownload, `{"type":"mac-intel"}`)
	// human-1:只点单平台 → 保留
	seedAnonEvent(t, "human-1", EventHomepageDownload, `{"type":"windows"}`)
	// 两台设备都访问了首页 → 首页访问不受下载爬虫过滤影响
	seedAnonEvent(t, "bot-1", EventHomepageVisit, "")
	seedAnonEvent(t, "human-1", EventHomepageVisit, "")

	start := time.Now().AddDate(0, 0, -1)
	end := time.Now().Add(time.Hour)

	// GetClientEventStats:下载点击剔除爬虫后仅剩 human-1 的 1 次
	dlStats, err := GetClientEventStats(start, end, EventHomepageDownload, nil)
	require.NoError(t, err)
	require.Len(t, dlStats, 1)
	assert.Equal(t, int64(1), dlStats[0].Count, "下载点击总量应剔除爬虫,仅剩真人 1 次")
	assert.Equal(t, int64(1), dlStats[0].UniqueUsers, "下载 UV 仅剩真人 1 台")

	// 首页访问不应被下载爬虫过滤误伤:bot-1、human-1 各 1 次,共 2
	visitStats, err := GetClientEventStats(start, end, EventHomepageVisit, nil)
	require.NoError(t, err)
	require.Len(t, visitStats, 1)
	assert.Equal(t, int64(2), visitStats[0].Count, "首页访问不受下载爬虫过滤影响,应保留 2 次")

	// GetClientEventTrend:下载点击按天聚合同样剔除爬虫 → 当日仅 1 次
	dlTrend, err := GetClientEventTrend(start, end, EventHomepageDownload, nil)
	require.NoError(t, err)
	var dlTrendTotal int64
	for _, p := range dlTrend {
		dlTrendTotal += p.Count
	}
	assert.Equal(t, int64(1), dlTrendTotal, "下载趋势总量应剔除爬虫,仅剩真人 1 次")

	// 趋势图里首页访问系列不受影响
	visitTrend, err := GetClientEventTrend(start, end, EventHomepageVisit, nil)
	require.NoError(t, err)
	var visitTrendTotal int64
	for _, p := range visitTrend {
		visitTrendTotal += p.Count
	}
	assert.Equal(t, int64(2), visitTrendTotal, "首页访问趋势不受下载爬虫过滤影响")
}

// 匿名事件 UV 统计:同一事件 3 台不同设备 → unique_users=3(修复前恒为 1)。
func TestGetClientEventStatsAnonymousUV(t *testing.T) {
	setupFunnelTestDB(t)

	seedAnonEvent(t, "dev-A", "官网首页访问", "")
	seedAnonEvent(t, "dev-A", "官网首页访问", "")
	seedAnonEvent(t, "dev-B", "官网首页访问", "")
	seedAnonEvent(t, "dev-C", "官网首页访问", "")

	start := time.Now().AddDate(0, 0, -1)
	end := time.Now().Add(time.Hour)

	stats, err := GetClientEventStats(start, end, "官网首页访问", nil)
	require.NoError(t, err)
	require.Len(t, stats, 1)
	assert.Equal(t, int64(4), stats[0].Count, "PV=4 次访问")
	assert.Equal(t, int64(3), stats[0].UniqueUsers, "UV=3 台设备(修复前会=1)")
}
