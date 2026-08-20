package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupModelChannelTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&Channel{}))
	assert.NoError(t, db.AutoMigrate(&Ability{}))
	assert.NoError(t, db.AutoMigrate(&ModelDefinition{}))
	DB = db
	common.UsingSQLite = true
}

func intPtr(v int64) *int64 { return &v }

// TestChannelUpdateDoesNotWipeModelPageSource 是整个 A 路线的核心验收:
// 模型页给某渠道挂了一个来源后,渠道页保存(Update)不应把它删掉。
func TestChannelUpdateDoesNotWipeModelPageSource(t *testing.T) {
	setupModelChannelTestDB(t)

	// 一个启用的渠道,初始只支持 model-a
	ch := &Channel{Name: "渠道1", Status: ChannelStatusEnabled, Models: "model-a", Group: "default", Priority: intPtr(0)}
	assert.NoError(t, ch.Insert()) // Insert 会按 Models 建 ability(model-a)

	// 模型页给该渠道新增来源 model-b(直接写 ability,channel.Models 里没有它)
	assert.NoError(t, AddModelChannelSource("model-b", ch.Id, "default", nil))

	var before int64
	DB.Model(&Ability{}).Where("channel_id = ?", ch.Id).Count(&before)
	assert.Equal(t, int64(2), before, "应有 model-a + model-b 两条来源")

	// 渠道页改个名字保存 —— 旧逻辑会全删重建只剩 model-a,新逻辑应保留两条
	ch.Name = "渠道1-改名"
	assert.NoError(t, ch.Update())

	var after int64
	DB.Model(&Ability{}).Where("channel_id = ?", ch.Id).Count(&after)
	assert.Equal(t, int64(2), after, "渠道保存后模型页配置的来源不应被冲掉")

	var b Ability
	assert.NoError(t, DB.Where("channel_id = ? AND model = ?", ch.Id, "model-b").First(&b).Error)
}

// TestChannelUpdateSyncsPriorityAndEnabled 验证渠道保存会把 priority/enabled 同步到已有 ability。
func TestChannelUpdateSyncsPriorityAndEnabled(t *testing.T) {
	setupModelChannelTestDB(t)

	ch := &Channel{Name: "渠道2", Status: ChannelStatusEnabled, Models: "m1", Group: "default", Priority: intPtr(5)}
	assert.NoError(t, ch.Insert())

	// 停用渠道并改优先级后保存
	ch.Status = ChannelStatusManuallyDisabled
	ch.Priority = intPtr(9)
	assert.NoError(t, ch.Update())

	var a Ability
	assert.NoError(t, DB.Where("channel_id = ?", ch.Id).First(&a).Error)
	assert.False(t, a.Enabled, "渠道停用后 ability 应同步 enabled=false")
	assert.Equal(t, int64(9), *a.Priority, "ability 优先级应同步")
}

// TestModelChannelSourceCRUD 验证来源增删与优先级设置。
func TestModelChannelSourceCRUD(t *testing.T) {
	setupModelChannelTestDB(t)

	ch := &Channel{Name: "渠道3", Status: ChannelStatusEnabled, Models: "", Group: "default", Priority: intPtr(0)}
	assert.NoError(t, ch.Insert())

	assert.NoError(t, AddModelChannelSource("gpt-x", ch.Id, "default", intPtr(3)))
	sources, err := GetModelChannelSources("gpt-x")
	assert.NoError(t, err)
	assert.Len(t, sources, 1)
	assert.Equal(t, ch.Id, sources[0].ChannelId)
	assert.Equal(t, "渠道3", sources[0].ChannelName)
	assert.Equal(t, int64(3), sources[0].Priority)

	assert.NoError(t, SetModelChannelSourcePriority("gpt-x", ch.Id, "default", 7))
	sources, _ = GetModelChannelSources("gpt-x")
	assert.Equal(t, int64(7), sources[0].Priority)

	assert.NoError(t, DeleteModelChannelSource("gpt-x", ch.Id, "default"))
	sources, _ = GetModelChannelSources("gpt-x")
	assert.Len(t, sources, 0)
}
