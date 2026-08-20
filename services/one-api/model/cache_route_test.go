package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupCacheRouteTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&Channel{}))
	assert.NoError(t, db.AutoMigrate(&Ability{}))
	assert.NoError(t, db.AutoMigrate(&ModelDefinition{}))
	DB = db
	common.UsingSQLite = true
}

// TestCacheRoutesFromAbilityNotChannelModels 验证 T1.5 核心:
// 内存缓存路由表以 ability 为权威,模型页加的来源(channel.Models 里没有)也能被路由命中。
func TestCacheRoutesFromAbilityNotChannelModels(t *testing.T) {
	setupCacheRouteTestDB(t)

	// 渠道的 Models 字符串里只有 base-model,但模型页给它挂了 extra-model
	ch := &Channel{Name: "c1", Status: ChannelStatusEnabled, Models: "base-model", Group: "default", Priority: intPtr(0)}
	assert.NoError(t, ch.Insert())
	assert.NoError(t, AddModelChannelSource("extra-model", ch.Id, "default", nil))

	InitChannelCache()

	prev := config.MemoryCacheEnabled
	config.MemoryCacheEnabled = true
	defer func() { config.MemoryCacheEnabled = prev }()

	// 缓存模式下,extra-model(仅存在于 ability)应能路由到 c1
	got, err := CacheGetRandomSatisfiedChannel("default", "extra-model", false)
	assert.NoError(t, err)
	assert.Equal(t, ch.Id, got.Id)
}

// TestCacheAndDBModeConsistent 验证缓存开/关两种模式选渠道结果一致(T4.2 验收项)。
func TestCacheAndDBModeConsistent(t *testing.T) {
	setupCacheRouteTestDB(t)

	ch := &Channel{Name: "c1", Status: ChannelStatusEnabled, Models: "", Group: "default", Priority: intPtr(0)}
	assert.NoError(t, ch.Insert())
	assert.NoError(t, AddModelChannelSource("m", ch.Id, "default", nil))
	InitChannelCache()

	prev := config.MemoryCacheEnabled
	defer func() { config.MemoryCacheEnabled = prev }()

	// DB 直查模式
	config.MemoryCacheEnabled = false
	dbCh, err := CacheGetRandomSatisfiedChannel("default", "m", false)
	assert.NoError(t, err)

	// 缓存模式
	config.MemoryCacheEnabled = true
	cacheCh, err := CacheGetRandomSatisfiedChannel("default", "m", false)
	assert.NoError(t, err)

	assert.Equal(t, dbCh.Id, cacheCh.Id, "两种模式应选到同一渠道")
}

// TestCacheExcludesDisabledSource 验证停用来源不被缓存路由命中。
func TestCacheExcludesDisabledSource(t *testing.T) {
	setupCacheRouteTestDB(t)

	ch := &Channel{Name: "c1", Status: ChannelStatusEnabled, Models: "m", Group: "default", Priority: intPtr(0)}
	assert.NoError(t, ch.Insert())
	// 停用渠道 → ability.enabled 同步为 false
	UpdateChannelStatusById(ch.Id, ChannelStatusManuallyDisabled)
	InitChannelCache()

	prev := config.MemoryCacheEnabled
	config.MemoryCacheEnabled = true
	defer func() { config.MemoryCacheEnabled = prev }()

	_, err := CacheGetRandomSatisfiedChannel("default", "m", false)
	assert.Error(t, err, "停用渠道的来源不应被路由")
}
