package model

import (
	"testing"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupActivityParticipationTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)

	// 迁移所有需要的表
	assert.NoError(t, db.AutoMigrate(&ActivityParticipation{}))
	assert.NoError(t, db.AutoMigrate(&Activity{}))
	assert.NoError(t, db.AutoMigrate(&User{}))
	assert.NoError(t, db.AutoMigrate(&UserTimedQuota{}))
	assert.NoError(t, db.AutoMigrate(&Log{}))

	DB = db
	LOG_DB = db
	common.UsingSQLite = true
}

func TestActivityParticipationTableName(t *testing.T) {
	p := ActivityParticipation{}
	assert.Equal(t, "activity_participations", p.TableName())
}

func TestHasParticipated_Once(t *testing.T) {
	setupActivityParticipationTestDB(t)

	// 首次检查，应该返回 false
	participated, err := HasParticipated(1, 1, "once")
	assert.NoError(t, err)
	assert.False(t, participated)

	// 创建一条参与记录
	participation := &ActivityParticipation{
		ActivityId:        1,
		UserId:            1,
		ParticipationTime: time.Now(),
		RewardStatus:      "granted",
		RewardAmount:      1000,
	}
	assert.NoError(t, DB.Create(participation).Error)

	// 再次检查，应该返回 true
	participated, err = HasParticipated(1, 1, "once")
	assert.NoError(t, err)
	assert.True(t, participated)

	// 不同用户应该返回 false
	participated, err = HasParticipated(1, 2, "once")
	assert.NoError(t, err)
	assert.False(t, participated)
}

func TestHasParticipated_Daily(t *testing.T) {
	setupActivityParticipationTestDB(t)

	now := time.Now()
	yesterday := now.Add(-24 * time.Hour)

	// 创建昨天的参与记录
	participation := &ActivityParticipation{
		ActivityId:        1,
		UserId:            1,
		ParticipationTime: yesterday,
		RewardStatus:      "granted",
	}
	assert.NoError(t, DB.Create(participation).Error)

	// 检查今天是否参与，应该返回 false（昨天的记录不算）
	participated, err := HasParticipated(1, 1, "daily")
	assert.NoError(t, err)
	assert.False(t, participated)

	// 创建今天的参与记录
	todayParticipation := &ActivityParticipation{
		ActivityId:        1,
		UserId:            1,
		ParticipationTime: now,
		RewardStatus:      "granted",
	}
	assert.NoError(t, DB.Create(todayParticipation).Error)

	// 再次检查，应该返回 true
	participated, err = HasParticipated(1, 1, "daily")
	assert.NoError(t, err)
	assert.True(t, participated)
}

func TestHasParticipated_Unlimited(t *testing.T) {
	setupActivityParticipationTestDB(t)

	// 创建多条参与记录
	for i := 0; i < 5; i++ {
		participation := &ActivityParticipation{
			ActivityId:        1,
			UserId:            1,
			ParticipationTime: time.Now(),
			RewardStatus:      "granted",
		}
		assert.NoError(t, DB.Create(participation).Error)
	}

	// unlimited 模式应该总是返回 false
	participated, err := HasParticipated(1, 1, "unlimited")
	assert.NoError(t, err)
	assert.False(t, participated)
}

func TestHasParticipated_InvalidParams(t *testing.T) {
	setupActivityParticipationTestDB(t)

	// 活动ID为0
	_, err := HasParticipated(0, 1, "once")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "活动ID或用户ID不能为空")

	// 用户ID为0
	_, err = HasParticipated(1, 0, "once")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "活动ID或用户ID不能为空")

	// 未知的限领规则
	_, err = HasParticipated(1, 1, "unknown")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "未知的限领规则")
}

func TestRecordParticipation(t *testing.T) {
	setupActivityParticipationTestDB(t)

	// 创建测试活动
	activity := &Activity{
		Name:   "测试活动",
		Status: "active",
	}
	assert.NoError(t, DB.Create(activity).Error)

	// 创建测试用户
	user := &User{
		Username:          "testuser",
		Password:          "hashedpassword",
		DisplayName:       "Test User",
		SubscriptionQuota: 0,
		TimedQuotaTotal:   0,
		Quota:             0,
	}
	assert.NoError(t, DB.Create(user).Error)

	// 记录参与并发放积分
	amount := int64(1000)
	err := RecordParticipation(activity.Id, user.Id, amount, nil)
	assert.NoError(t, err)

	// 验证参与记录已创建
	var participation ActivityParticipation
	err = DB.Where("activity_id = ? AND user_id = ?", activity.Id, user.Id).First(&participation).Error
	assert.NoError(t, err)
	assert.Equal(t, activity.Id, participation.ActivityId)
	assert.Equal(t, user.Id, participation.UserId)
	assert.Equal(t, "granted", participation.RewardStatus)
	assert.Equal(t, amount, participation.RewardAmount)
	assert.NotNil(t, participation.RewardGrantedAt)

	// 验证用户积分已增加（通过 timed_quota_total）
	var updatedUser User
	err = DB.First(&updatedUser, user.Id).Error
	assert.NoError(t, err)
	assert.Equal(t, amount, updatedUser.TimedQuotaTotal)

	// 验证定时积分账本记录
	var timedQuota UserTimedQuota
	err = DB.Where("user_id = ? AND source = ?", user.Id, TimedQuotaSourceActivity).First(&timedQuota).Error
	assert.NoError(t, err)
	assert.Equal(t, amount, timedQuota.Amount)
	assert.Equal(t, amount, timedQuota.Remaining)

	// 验证活动预算已更新
	var updatedActivity Activity
	err = DB.First(&updatedActivity, activity.Id).Error
	assert.NoError(t, err)
	assert.Equal(t, amount, updatedActivity.UsedBudget)

	// 验证日志记录
	var log Log
	err = LOG_DB.Where("user_id = ? AND type = ?", user.Id, LogTypeSystem).First(&log).Error
	assert.NoError(t, err)
	assert.Contains(t, log.Content, "测试活动")
}

func TestRecordParticipation_ZeroAmount(t *testing.T) {
	setupActivityParticipationTestDB(t)

	// 创建测试活动和用户
	activity := &Activity{Name: "零积分活动", Status: "active"}
	assert.NoError(t, DB.Create(activity).Error)
	user := &User{Username: "testuser2", Password: "hash", DisplayName: "User2"}
	assert.NoError(t, DB.Create(user).Error)

	// 记录参与但不发放积分
	err := RecordParticipation(activity.Id, user.Id, 0, nil)
	assert.NoError(t, err)

	// 验证参与记录已创建但 reward_status = pending
	var participation ActivityParticipation
	err = DB.Where("activity_id = ? AND user_id = ?", activity.Id, user.Id).First(&participation).Error
	assert.NoError(t, err)
	assert.Equal(t, "pending", participation.RewardStatus)
	assert.Equal(t, int64(0), participation.RewardAmount)
	assert.Nil(t, participation.RewardGrantedAt)
}

func TestRecordParticipation_InvalidParams(t *testing.T) {
	setupActivityParticipationTestDB(t)

	// 活动ID为0
	err := RecordParticipation(0, 1, 1000, nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "活动ID或用户ID不能为空")

	// 用户ID为0
	err = RecordParticipation(1, 0, 1000, nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "活动ID或用户ID不能为空")

	// 金额为负数
	err = RecordParticipation(1, 1, -1000, nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "发放金额不能为负数")
}

func TestGetParticipationStats(t *testing.T) {
	setupActivityParticipationTestDB(t)

	activityId := 1

	// 创建测试数据：3个用户，5条记录
	now := time.Now()
	yesterday := now.Add(-24 * time.Hour)

	participations := []*ActivityParticipation{
		{ActivityId: activityId, UserId: 1, RewardStatus: "granted", RewardAmount: 1000, ParticipationTime: now},
		{ActivityId: activityId, UserId: 1, RewardStatus: "granted", RewardAmount: 500, ParticipationTime: now},
		{ActivityId: activityId, UserId: 2, RewardStatus: "granted", RewardAmount: 2000, ParticipationTime: now},
		{ActivityId: activityId, UserId: 3, RewardStatus: "pending", RewardAmount: 0, ParticipationTime: yesterday},
		{ActivityId: activityId, UserId: 3, RewardStatus: "granted", RewardAmount: 1500, ParticipationTime: now},
	}

	for _, p := range participations {
		assert.NoError(t, DB.Create(p).Error)
	}

	// 获取统计
	stats, err := GetParticipationStats(activityId)
	assert.NoError(t, err)
	assert.NotNil(t, stats)

	// 验证统计数据
	assert.Equal(t, int64(3), stats["total_users"])
	assert.Equal(t, int64(5), stats["total_participations"])
	assert.Equal(t, int64(5000), stats["total_granted"])
	assert.Equal(t, int64(3), stats["today_users"])
}

func TestGetParticipationStats_EmptyActivity(t *testing.T) {
	setupActivityParticipationTestDB(t)

	stats, err := GetParticipationStats(999)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), stats["total_users"])
	assert.Equal(t, int64(0), stats["total_participations"])
	assert.Equal(t, int64(0), stats["total_granted"])
	assert.Equal(t, int64(0), stats["today_users"])
}

func TestGetParticipationStats_InvalidParams(t *testing.T) {
	setupActivityParticipationTestDB(t)

	_, err := GetParticipationStats(0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "活动ID不能为空")
}

func TestGetUserParticipations(t *testing.T) {
	setupActivityParticipationTestDB(t)

	userId := 1

	// 创建测试数据
	for i := 1; i <= 5; i++ {
		p := &ActivityParticipation{
			ActivityId:        i,
			UserId:            userId,
			ParticipationTime: time.Now().Add(time.Duration(i) * time.Second),
			RewardStatus:      "granted",
			RewardAmount:      int64(i * 1000),
		}
		assert.NoError(t, DB.Create(p).Error)
	}

	// 获取所有记录
	participations, err := GetUserParticipations(userId, 0)
	assert.NoError(t, err)
	assert.Len(t, participations, 5)

	// 获取限制数量的记录
	participations, err = GetUserParticipations(userId, 3)
	assert.NoError(t, err)
	assert.Len(t, participations, 3)
}

func TestGetActivityParticipations(t *testing.T) {
	setupActivityParticipationTestDB(t)

	activityId := 1

	// 创建测试数据
	for i := 1; i <= 10; i++ {
		p := &ActivityParticipation{
			ActivityId:        activityId,
			UserId:            i,
			ParticipationTime: time.Now(),
			RewardStatus:      "granted",
			RewardAmount:      1000,
		}
		assert.NoError(t, DB.Create(p).Error)
	}

	// 获取第一页
	participations, err := GetActivityParticipations(activityId, 0, 5)
	assert.NoError(t, err)
	assert.Len(t, participations, 5)

	// 获取第二页
	participations, err = GetActivityParticipations(activityId, 5, 5)
	assert.NoError(t, err)
	assert.Len(t, participations, 5)

	// 获取第三页（应该为空）
	participations, err = GetActivityParticipations(activityId, 10, 5)
	assert.NoError(t, err)
	assert.Len(t, participations, 0)
}
