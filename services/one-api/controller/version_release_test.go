package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/model"
)

// 这些测试只在 :memory: SQLite 内运行,隔离于本地/生产数据库.

func setupVersionReleaseTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.VersionRelease{}))
	model.DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
	common.UsingMySQL = false
}

// extractSiteVersion 正则解析：覆盖属性顺序/引号/大小写/缺失等情况
func TestExtractSiteVersion(t *testing.T) {
	cases := []struct {
		name string
		html string
		want string
	}{
		{
			name: "标准双引号",
			html: `<meta name="site-version" content="2.0.4+abc123.20260610090057">`,
			want: "2.0.4+abc123.20260610090057",
		},
		{
			name: "单引号",
			html: `<meta name='site-version' content='v9'>`,
			want: "v9",
		},
		{
			name: "大小写混合标签",
			html: `<META Name="site-version" Content="X1">`,
			want: "X1",
		},
		{
			name: "夹在完整 head 中",
			html: `<head><meta charset="UTF-8"><meta name="site-version" content="abc"><title>x</title></head>`,
			want: "abc",
		},
		{
			name: "未埋版本号",
			html: `<head><meta charset="UTF-8"></head>`,
			want: "",
		},
		{
			name: "占位符未被替换(发布脚本未跑)",
			html: `<meta name="site-version" content="{{SITE_VERSION}}">`,
			want: "{{SITE_VERSION}}", // 能抠出,但内容是占位符;探测器据此仍会记一次,可接受
		},
		{
			name: "空字符串",
			html: ``,
			want: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, extractSiteVersion(tc.html))
		})
	}
}

func TestReleaseDetectorURLsRequireExplicitConfiguration(t *testing.T) {
	t.Setenv("RELEASE_DETECT_APP_URL", "")
	t.Setenv("RELEASE_DETECT_WEB_URL", "")
	t.Setenv("RELEASE_DETECT_BACKEND_URL", "")
	assert.Empty(t, detectAppLatestURL())
	assert.Empty(t, detectWebHomeURL())
	assert.Empty(t, detectBackendStatusURL())

	t.Setenv("RELEASE_DETECT_APP_URL", "  http://updates.internal/latest.json  ")
	assert.Equal(t, "http://updates.internal/latest.json", detectAppLatestURL())
}

// recordIfChanged 去重：相同 signal 不重复记,变化才记
func TestRecordIfChanged_Dedup(t *testing.T) {
	setupVersionReleaseTestDB(t)

	count := func(platform string) int64 {
		var n int64
		model.DB.Model(&model.VersionRelease{}).Where("platform = ?", platform).Count(&n)
		return n
	}

	// 首次:无记录 → 插入
	recordIfChanged(model.VersionPlatformApp, "2.0.4", "2.0.4@t1")
	assert.Equal(t, int64(1), count(model.VersionPlatformApp), "首次应插入")

	// 相同 signal → 不重复
	recordIfChanged(model.VersionPlatformApp, "2.0.4", "2.0.4@t1")
	recordIfChanged(model.VersionPlatformApp, "2.0.4", "2.0.4@t1")
	assert.Equal(t, int64(1), count(model.VersionPlatformApp), "相同 signal 不应重复记录")

	// signal 变化(同版本号但 pub_date 变) → 新增
	recordIfChanged(model.VersionPlatformApp, "2.0.4", "2.0.4@t2")
	assert.Equal(t, int64(2), count(model.VersionPlatformApp), "signal 变化应新增")

	// 版本号变化 → 新增
	recordIfChanged(model.VersionPlatformApp, "2.0.5", "2.0.5@t3")
	assert.Equal(t, int64(3), count(model.VersionPlatformApp), "新版本应新增")
}

// 空 signal 不记录(探测失败/未埋版本号时不应污染记录)
func TestRecordIfChanged_EmptySignalSkipped(t *testing.T) {
	setupVersionReleaseTestDB(t)
	recordIfChanged(model.VersionPlatformWeb, "", "")
	var n int64
	model.DB.Model(&model.VersionRelease{}).Count(&n)
	assert.Equal(t, int64(0), n, "空 signal 不应记录")
}

// 不同平台互不干扰:各自独立判断变化
func TestRecordIfChanged_PerPlatformIsolation(t *testing.T) {
	setupVersionReleaseTestDB(t)

	// 后端用 start_time 作 signal(version 为 v0.0.0)
	recordIfChanged(model.VersionPlatformBackend, "v0.0.0", "start_time=1000")
	recordIfChanged(model.VersionPlatformBackend, "v0.0.0", "start_time=1000") // 未重启,不记
	recordIfChanged(model.VersionPlatformBackend, "v0.0.0", "start_time=2000") // 重启,记

	// app 与 backend 各自独立
	recordIfChanged(model.VersionPlatformApp, "2.0.4", "2.0.4@t1")

	var backendCount, appCount int64
	model.DB.Model(&model.VersionRelease{}).Where("platform = ?", model.VersionPlatformBackend).Count(&backendCount)
	model.DB.Model(&model.VersionRelease{}).Where("platform = ?", model.VersionPlatformApp).Count(&appCount)
	assert.Equal(t, int64(2), backendCount, "后端两次不同 start_time 记 2 条")
	assert.Equal(t, int64(1), appCount, "app 独立记 1 条")

	// 取最近一条应为最新 start_time
	last, err := model.GetLatestVersionRelease(model.VersionPlatformBackend)
	require.NoError(t, err)
	assert.Equal(t, "start_time=2000", last.Signal)
}
