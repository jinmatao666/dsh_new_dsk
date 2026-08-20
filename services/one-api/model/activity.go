package model

import (
	"encoding/json"
	"errors"
	"time"
)

// Activity 活动管理
type Activity struct {
	Id        int        `json:"id" gorm:"primaryKey;autoIncrement"`
	Name      string     `json:"name" gorm:"type:varchar(100);not null"`
	StartTime *time.Time `json:"start_time"`
	EndTime   *time.Time `json:"end_time"`
	UserType  string     `json:"user_type" gorm:"type:varchar(20);not null;default:'all'"` // all, personal, enterprise
	Benefits  string     `json:"benefits" gorm:"type:text"`
	Cycle     string     `json:"cycle" gorm:"type:varchar(20);not null;default:'once'"`   // once, daily, weekly, monthly
	Status    string     `json:"status" gorm:"type:varchar(20);not null;default:'draft'"` // draft, active, paused, ended

	// 新增字段
	MechanismType    string     `json:"mechanism_type" gorm:"type:varchar(20);not null;default:'manual'"`  // manual, auto
	TriggerType      string     `json:"trigger_type" gorm:"type:varchar(20);not null;default:'none'"`      // none, registration, login, recharge, redeem(达人兑换码兑换)
	TriggerConfig    string     `json:"trigger_config" gorm:"type:text"`                                   // JSON 配置
	TargetCrowdId    *int       `json:"target_crowd_id" gorm:"type:int;default:null"`                      // 目标分群ID，null表示不限
	UserTags         string     `json:"user_tags" gorm:"type:varchar(255)"`                                // 用户标签，逗号分隔
	GrantMethod      string     `json:"grant_method" gorm:"type:varchar(20);not null;default:'immediate'"` // immediate, scheduled
	ScheduledAt      *time.Time `json:"scheduled_at"`                                                      // 定时发放时间
	GrantLimit       string     `json:"grant_limit" gorm:"type:varchar(20);not null;default:'once'"`       // once, daily, unlimited
	RewardType       string     `json:"reward_type" gorm:"type:varchar(20);not null;default:'quota'"`      // quota, coupon
	RewardSubtype    string     `json:"reward_subtype" gorm:"type:varchar(20);not null;default:'points'"`  // points, vip, discount, deduction
	RewardAmount     int64      `json:"reward_amount" gorm:"type:bigint;default:0"`                        // 奖励数额（积分/天数/折扣系数/抵扣金额）
	RewardIdentityId *int       `json:"reward_identity_id" gorm:"type:int;default:null"`                   // vip 类型时关联的会员身份ID
	RewardExpiresAt  *time.Time `json:"reward_expires_at" gorm:"default:null"`                             // 权益到期时间，null=不限时
	TotalBudget      *int64     `json:"total_budget" gorm:"type:bigint;default:null"`                      // 总预算，null表示不限
	UsedBudget       int64      `json:"used_budget" gorm:"type:bigint;default:0"`                          // 已使用预算
	GrantRole        string     `json:"grant_role" gorm:"type:varchar(20);not null;default:'invitee'"`     // inviter=奖励邀请人, invitee=奖励被邀请人

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`

	// AdminPassword 仅用于「同类活动冲突」二次确认，不落库。检测到同维度已有生效活动时，
	// 管理员需带此字段重新提交以强制保存（走 validateCurrentAdminPassword 校验）。
	AdminPassword string `json:"admin_password" gorm:"-"`
}

// TriggerConfig 触发配置结构体
type TriggerConfig struct {
	// 注册触发配置
	NewUserOnly bool `json:"new_user_only"` // 仅限新用户
	NewUserDays int  `json:"new_user_days"` // 新用户定义：注册N天内

	// 充值触发配置
	MinRechargeAmount int64 `json:"min_recharge_amount"` // 最低充值金额
	MaxRechargeAmount int64 `json:"max_recharge_amount"` // 最高充值金额，0表示不限

	// 登录触发配置
	ConsecutiveDays int `json:"consecutive_days"` // 连续登录天数

	// 邀请触发配置
	MinPaymentAmount int64 `json:"min_payment_amount"` // invite_payment 子类型：最低付款金额（分），0不限
}

// TableName 指定表名
func (Activity) TableName() string {
	return "activities"
}

// GetAllActivities 获取所有活动
func GetAllActivities() ([]*Activity, error) {
	var activities []*Activity
	err := DB.Order("id desc").Find(&activities).Error
	return activities, err
}

// GetActivityById 根据ID获取活动
func GetActivityById(id int) (*Activity, error) {
	var activity Activity
	err := DB.First(&activity, id).Error
	if err != nil {
		return nil, err
	}
	return &activity, nil
}

// CreateActivity 创建活动
func CreateActivity(activity *Activity) error {
	if activity.Name == "" {
		return errors.New("活动名称不能为空")
	}
	return DB.Create(activity).Error
}

// conflictExemptTriggerType 不参与「同类唯一」约束的触发类型：
// manual（手动领取，允许多个并存）、none/空（无触发，纯占位/草稿）。
func conflictExemptTriggerType(triggerType string) bool {
	switch triggerType {
	case "manual", "none", "":
		return true
	default:
		return false
	}
}

// FindConflictingActiveActivity 查找与给定活动「同触发事件 + 同奖励角色」且处于 active 状态的另一个活动。
//
// 约束维度是 (trigger_type, grant_role)：
//   - 拦住真正的重复（如两条签到、两条 invite_registration/inviter）——它们会各触发一次导致重复发放；
//   - 放行合法组合（如 invite_registration 的 inviter 一条 + invitee 一条，给邀请人/被邀请人配不同积分）。
//
// grantRole 为空按 "invitee" 归一（与发放逻辑默认一致）。manual/none 类不参与约束返回 (nil,nil)。
// excludeId 用于更新场景排除自身。返回第一个冲突活动名，无冲突返回 ("", nil)。
func FindConflictingActiveActivity(triggerType, grantRole string, excludeId int) (string, error) {
	if conflictExemptTriggerType(triggerType) {
		return "", nil
	}
	if grantRole == "" {
		grantRole = "invitee"
	}
	var activities []*Activity
	err := DB.Select("id", "name").
		Where("status = ? AND trigger_type = ? AND COALESCE(NULLIF(grant_role, ''), 'invitee') = ? AND id <> ?",
			"active", triggerType, grantRole, excludeId).
		Limit(1).Find(&activities).Error
	if err != nil {
		return "", err
	}
	if len(activities) == 0 {
		return "", nil
	}
	return activities[0].Name, nil
}

// UpdateActivity 更新活动
func UpdateActivity(activity *Activity) error {
	if activity.Id == 0 {
		return errors.New("活动ID不能为空")
	}
	if activity.Name == "" {
		return errors.New("活动名称不能为空")
	}
	return DB.Model(&Activity{}).Where("id = ?", activity.Id).Updates(map[string]interface{}{
		"name":               activity.Name,
		"start_time":         activity.StartTime,
		"end_time":           activity.EndTime,
		"status":             activity.Status,
		"mechanism_type":     activity.MechanismType,
		"trigger_type":       activity.TriggerType,
		"trigger_config":     activity.TriggerConfig,
		"target_crowd_id":    activity.TargetCrowdId,
		"user_tags":          activity.UserTags,
		"grant_method":       activity.GrantMethod,
		"scheduled_at":       activity.ScheduledAt,
		"grant_limit":        activity.GrantLimit,
		"grant_role":         activity.GrantRole,
		"reward_type":        activity.RewardType,
		"reward_subtype":     activity.RewardSubtype,
		"reward_amount":      activity.RewardAmount,
		"reward_identity_id": activity.RewardIdentityId,
		"reward_expires_at":  activity.RewardExpiresAt,
		"total_budget":       activity.TotalBudget,
	}).Error
}

// DeleteActivity 删除活动
func DeleteActivity(id int) error {
	if id == 0 {
		return errors.New("活动ID不能为空")
	}
	return DB.Delete(&Activity{}, id).Error
}

// ParseTriggerConfig 解析触发配置 JSON
func (a *Activity) ParseTriggerConfig() (*TriggerConfig, error) {
	if a.TriggerConfig == "" {
		return &TriggerConfig{}, nil
	}

	var config TriggerConfig
	if err := json.Unmarshal([]byte(a.TriggerConfig), &config); err != nil {
		return nil, errors.New("解析触发配置失败: " + err.Error())
	}

	return &config, nil
}

// MatchUser 检查用户是否匹配活动条件
func (a *Activity) MatchUser(userId int) (bool, error) {
	// 1. 检查活动是否激活
	if !a.IsActive() {
		return false, nil
	}

	// 2. 检查用户是否存在且活跃
	provider := GetUserProvider()
	user, err := provider.GetUserBasicInfo(userId)
	if err != nil {
		return false, err
	}

	if user.Status != UserStatusEnabled {
		return false, nil
	}

	// 3. 检查用户类型
	if a.UserType != "all" {
		if a.UserType == "personal" && user.AccountType != AccountTypePersonal {
			return false, nil
		}
		if a.UserType == "enterprise" && user.AccountType != AccountTypeEnterprise {
			return false, nil
		}
	}

	// 4. 解析并检查触发配置
	config, err := a.ParseTriggerConfig()
	if err != nil {
		return false, err
	}

	// 5. 检查新用户限制
	if config.NewUserOnly && config.NewUserDays > 0 {
		daysSinceRegistration := int(time.Since(user.CreatedAt).Hours() / 24)
		if daysSinceRegistration > config.NewUserDays {
			return false, nil
		}
	}

	return true, nil
}

// IsActive 检查活动是否在有效期内
func (a *Activity) IsActive() bool {
	if a.Status != "active" {
		return false
	}

	now := time.Now()

	// 检查开始时间
	if a.StartTime != nil && now.Before(*a.StartTime) {
		return false
	}

	// 检查结束时间
	if a.EndTime != nil && now.After(*a.EndTime) {
		return false
	}

	return true
}

// HasBudget 检查预算是否充足
func (a *Activity) HasBudget(amount int64) bool {
	// TotalBudget 为 nil 或 0 表示不限预算
	if a.TotalBudget == nil || *a.TotalBudget == 0 {
		return true
	}

	return a.UsedBudget+amount <= *a.TotalBudget
}

// GetActiveActivitiesByTrigger 查询指定触发类型的活动
func GetActiveActivitiesByTrigger(triggerType string) ([]*Activity, error) {
	var activities []*Activity
	now := time.Now()

	query := DB.Where("status = ? AND trigger_type = ?", "active", triggerType)

	// 添加时间范围过滤
	query = query.Where("(start_time IS NULL OR start_time <= ?)", now)
	query = query.Where("(end_time IS NULL OR end_time >= ?)", now)

	err := query.Order("id desc").Find(&activities).Error
	if err != nil {
		return nil, err
	}

	// 过滤预算已用完的活动
	result := make([]*Activity, 0, len(activities))
	for _, activity := range activities {
		if activity.TotalBudget == nil || *activity.TotalBudget == 0 || activity.UsedBudget < *activity.TotalBudget {
			result = append(result, activity)
		}
	}

	return result, nil
}

// GetActiveActivitiesByCrowd 查询指定分群的活动
func GetActiveActivitiesByCrowd(crowdId int) ([]*Activity, error) {
	var activities []*Activity
	now := time.Now()

	query := DB.Where("status = ? AND target_crowd_id = ?", "active", crowdId)

	// 添加时间范围过滤
	query = query.Where("(start_time IS NULL OR start_time <= ?)", now)
	query = query.Where("(end_time IS NULL OR end_time >= ?)", now)

	err := query.Order("id desc").Find(&activities).Error
	if err != nil {
		return nil, err
	}

	// 过滤预算已用完的活动
	result := make([]*Activity, 0, len(activities))
	for _, activity := range activities {
		if activity.TotalBudget == nil || *activity.TotalBudget == 0 || activity.UsedBudget < *activity.TotalBudget {
			result = append(result, activity)
		}
	}

	return result, nil
}
