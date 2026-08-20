package model

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
)

func setupActivityTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Activity{}))
	DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
}

func TestParseTriggerConfig(t *testing.T) {
	t.Run("空配置", func(t *testing.T) {
		activity := &Activity{TriggerConfig: ""}
		config, err := activity.ParseTriggerConfig()
		require.NoError(t, err)
		assert.NotNil(t, config)
	})

	t.Run("有效的 JSON 配置", func(t *testing.T) {
		configData := TriggerConfig{
			NewUserOnly:       true,
			NewUserDays:       7,
			MinRechargeAmount: 1000,
			MaxRechargeAmount: 10000,
			ConsecutiveDays:   3,
		}
		configJSON, _ := json.Marshal(configData)

		activity := &Activity{TriggerConfig: string(configJSON)}
		config, err := activity.ParseTriggerConfig()
		require.NoError(t, err)
		assert.True(t, config.NewUserOnly)
		assert.Equal(t, 7, config.NewUserDays)
		assert.Equal(t, int64(1000), config.MinRechargeAmount)
		assert.Equal(t, int64(10000), config.MaxRechargeAmount)
		assert.Equal(t, 3, config.ConsecutiveDays)
	})

	t.Run("无效的 JSON 配置", func(t *testing.T) {
		activity := &Activity{TriggerConfig: "{invalid json}"}
		_, err := activity.ParseTriggerConfig()
		assert.Error(t, err)
	})
}

func TestIsActive(t *testing.T) {
	now := time.Now()

	t.Run("状态为 active 且无时间限制", func(t *testing.T) {
		activity := &Activity{
			Status:    "active",
			StartTime: nil,
			EndTime:   nil,
		}
		assert.True(t, activity.IsActive())
	})

	t.Run("状态为 draft", func(t *testing.T) {
		activity := &Activity{Status: "draft"}
		assert.False(t, activity.IsActive())
	})

	t.Run("状态为 paused", func(t *testing.T) {
		activity := &Activity{Status: "paused"}
		assert.False(t, activity.IsActive())
	})

	t.Run("活动未开始", func(t *testing.T) {
		future := now.Add(24 * time.Hour)
		activity := &Activity{
			Status:    "active",
			StartTime: &future,
		}
		assert.False(t, activity.IsActive())
	})

	t.Run("活动已结束", func(t *testing.T) {
		past := now.Add(-24 * time.Hour)
		activity := &Activity{
			Status:  "active",
			EndTime: &past,
		}
		assert.False(t, activity.IsActive())
	})

	t.Run("活动进行中", func(t *testing.T) {
		past := now.Add(-24 * time.Hour)
		future := now.Add(24 * time.Hour)
		activity := &Activity{
			Status:    "active",
			StartTime: &past,
			EndTime:   &future,
		}
		assert.True(t, activity.IsActive())
	})
}

func TestHasBudget(t *testing.T) {
	t.Run("无预算限制 (TotalBudget = nil)", func(t *testing.T) {
		activity := &Activity{
			TotalBudget: nil,
			UsedBudget:  5000,
		}
		assert.True(t, activity.HasBudget(1000))
		assert.True(t, activity.HasBudget(999999))
	})

	t.Run("无预算限制 (TotalBudget = 0)", func(t *testing.T) {
		zero := int64(0)
		activity := &Activity{
			TotalBudget: &zero,
			UsedBudget:  5000,
		}
		assert.True(t, activity.HasBudget(1000))
		assert.True(t, activity.HasBudget(999999))
	})

	t.Run("预算充足", func(t *testing.T) {
		budget := int64(10000)
		activity := &Activity{
			TotalBudget: &budget,
			UsedBudget:  5000,
		}
		assert.True(t, activity.HasBudget(5000))
		assert.True(t, activity.HasBudget(4999))
	})

	t.Run("预算不足", func(t *testing.T) {
		budget := int64(10000)
		activity := &Activity{
			TotalBudget: &budget,
			UsedBudget:  9500,
		}
		assert.False(t, activity.HasBudget(501))
		assert.True(t, activity.HasBudget(500))
	})

	t.Run("预算刚好用完", func(t *testing.T) {
		budget := int64(10000)
		activity := &Activity{
			TotalBudget: &budget,
			UsedBudget:  10000,
		}
		assert.False(t, activity.HasBudget(1))
	})
}

func TestMatchUser(t *testing.T) {
	// 使用 Mock Provider
	InitUserProvider("mock")

	now := time.Now()
	past := now.Add(-24 * time.Hour)
	future := now.Add(24 * time.Hour)

	t.Run("活动未激活", func(t *testing.T) {
		activity := &Activity{
			Status:   "draft",
			UserType: "all",
		}
		matched, err := activity.MatchUser(1)
		require.NoError(t, err)
		assert.False(t, matched)
	})

	t.Run("用户不存在", func(t *testing.T) {
		activity := &Activity{
			Status:    "active",
			StartTime: &past,
			EndTime:   &future,
			UserType:  "all",
		}
		matched, err := activity.MatchUser(999)
		assert.Error(t, err)
		assert.False(t, matched)
	})

	t.Run("用户已禁用", func(t *testing.T) {
		activity := &Activity{
			Status:    "active",
			StartTime: &past,
			EndTime:   &future,
			UserType:  "all",
		}
		// ID 5 是已禁用用户
		matched, err := activity.MatchUser(5)
		require.NoError(t, err)
		assert.False(t, matched)
	})

	t.Run("用户类型不匹配 - 要求个人用户", func(t *testing.T) {
		activity := &Activity{
			Status:    "active",
			StartTime: &past,
			EndTime:   &future,
			UserType:  "personal",
		}
		// ID 3 是企业用户
		matched, err := activity.MatchUser(3)
		require.NoError(t, err)
		assert.False(t, matched)
	})

	t.Run("用户类型匹配 - all", func(t *testing.T) {
		activity := &Activity{
			Status:    "active",
			StartTime: &past,
			EndTime:   &future,
			UserType:  "all",
		}
		matched, err := activity.MatchUser(1)
		require.NoError(t, err)
		assert.True(t, matched)
	})

	t.Run("新用户限制 - 老用户不匹配", func(t *testing.T) {
		config := TriggerConfig{
			NewUserOnly: true,
			NewUserDays: 7,
		}
		configJSON, _ := json.Marshal(config)

		activity := &Activity{
			Status:        "active",
			StartTime:     &past,
			EndTime:       &future,
			UserType:      "all",
			TriggerConfig: string(configJSON),
		}
		// ID 1 是 6 个月前注册的老用户
		matched, err := activity.MatchUser(1)
		require.NoError(t, err)
		assert.False(t, matched)
	})

	t.Run("新用户限制 - 新用户匹配", func(t *testing.T) {
		config := TriggerConfig{
			NewUserOnly: true,
			NewUserDays: 30,
		}
		configJSON, _ := json.Marshal(config)

		activity := &Activity{
			Status:        "active",
			StartTime:     &past,
			EndTime:       &future,
			UserType:      "all",
			TriggerConfig: string(configJSON),
		}
		// ID 4 是 7 天前注册的新用户
		matched, err := activity.MatchUser(4)
		require.NoError(t, err)
		assert.True(t, matched)
	})
}

func TestGetActiveActivitiesByTrigger(t *testing.T) {
	setupActivityTestDB(t)

	now := time.Now()
	past := now.Add(-24 * time.Hour)
	future := now.Add(24 * time.Hour)

	budget1 := int64(10000)
	budget2 := int64(10000)

	// 创建测试数据
	activities := []*Activity{
		{
			Name:        "注册活动1",
			Status:      "active",
			TriggerType: "registration",
			StartTime:   &past,
			EndTime:     &future,
			TotalBudget: &budget1,
			UsedBudget:  5000,
		},
		{
			Name:        "注册活动2 - 预算用尽",
			Status:      "active",
			TriggerType: "registration",
			StartTime:   &past,
			EndTime:     &future,
			TotalBudget: &budget2,
			UsedBudget:  10000,
		},
		{
			Name:        "登录活动",
			Status:      "active",
			TriggerType: "login",
			StartTime:   &past,
			EndTime:     &future,
		},
		{
			Name:        "注册活动3 - 未激活",
			Status:      "draft",
			TriggerType: "registration",
			StartTime:   &past,
			EndTime:     &future,
		},
	}

	for _, activity := range activities {
		require.NoError(t, DB.Create(activity).Error)
	}

	t.Run("查询注册类型活动", func(t *testing.T) {
		result, err := GetActiveActivitiesByTrigger("registration")
		require.NoError(t, err)
		// 应该只返回活动1，活动2预算用尽，活动3未激活
		assert.Len(t, result, 1)
		assert.Equal(t, "注册活动1", result[0].Name)
	})

	t.Run("查询登录类型活动", func(t *testing.T) {
		result, err := GetActiveActivitiesByTrigger("login")
		require.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "登录活动", result[0].Name)
	})

	t.Run("查询不存在的类型", func(t *testing.T) {
		result, err := GetActiveActivitiesByTrigger("nonexistent")
		require.NoError(t, err)
		assert.Len(t, result, 0)
	})
}

func TestGetActiveActivitiesByCrowd(t *testing.T) {
	setupActivityTestDB(t)

	now := time.Now()
	past := now.Add(-24 * time.Hour)
	future := now.Add(24 * time.Hour)

	budget1 := int64(10000)
	budget2 := int64(10000)
	crowdId1 := 1
	crowdId2 := 2

	// 创建测试数据
	activities := []*Activity{
		{
			Name:          "分群1活动1",
			Status:        "active",
			TargetCrowdId: &crowdId1,
			StartTime:     &past,
			EndTime:       &future,
			TotalBudget:   &budget1,
			UsedBudget:    5000,
		},
		{
			Name:          "分群1活动2 - 预算用尽",
			Status:        "active",
			TargetCrowdId: &crowdId1,
			StartTime:     &past,
			EndTime:       &future,
			TotalBudget:   &budget2,
			UsedBudget:    10000,
		},
		{
			Name:          "分群2活动",
			Status:        "active",
			TargetCrowdId: &crowdId2,
			StartTime:     &past,
			EndTime:       &future,
		},
		{
			Name:          "分群1活动3 - 未激活",
			Status:        "draft",
			TargetCrowdId: &crowdId1,
			StartTime:     &past,
			EndTime:       &future,
		},
	}

	for _, activity := range activities {
		require.NoError(t, DB.Create(activity).Error)
	}

	t.Run("查询分群1的活动", func(t *testing.T) {
		result, err := GetActiveActivitiesByCrowd(1)
		require.NoError(t, err)
		// 应该只返回活动1，活动2预算用尽，活动3未激活
		assert.Len(t, result, 1)
		assert.Equal(t, "分群1活动1", result[0].Name)
	})

	t.Run("查询分群2的活动", func(t *testing.T) {
		result, err := GetActiveActivitiesByCrowd(2)
		require.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "分群2活动", result[0].Name)
	})

	t.Run("查询不存在的分群", func(t *testing.T) {
		result, err := GetActiveActivitiesByCrowd(999)
		require.NoError(t, err)
		assert.Len(t, result, 0)
	})
}
