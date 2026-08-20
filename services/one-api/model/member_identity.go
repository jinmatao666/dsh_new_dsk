package model

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// MemberIdentity 会员身份定义：独立的会员等级来源。
// 身份持有 PackageLevel(等级);商品(recharge_packages)通过 identity_id 关联身份并派生等级。
// 活动/批量发放时选择身份，系统按 PackageLevel + 时长创建 Subscription。
type MemberIdentity struct {
	Id           int       `json:"id" gorm:"primaryKey;autoIncrement"`
	Name         string    `json:"name" gorm:"type:varchar(50);not null;uniqueIndex;comment:身份名称"`
	Description  string    `json:"description" gorm:"type:varchar(255);comment:描述"`
	PackageId    int       `json:"package_id" gorm:"default:0;comment:已废弃:旧版关联商品ID,身份独立后不再使用"`
	PackageLevel int       `json:"package_level" gorm:"default:1;comment:套餐等级"`
	Enabled      bool      `json:"enabled" gorm:"default:true;comment:是否启用"`
	CreatedAt    time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt    time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

func (MemberIdentity) TableName() string {
	return "member_identities"
}

func GetAllMemberIdentities(enabledOnly bool) ([]*MemberIdentity, error) {
	var list []*MemberIdentity
	q := DB.Model(&MemberIdentity{})
	if enabledOnly {
		q = q.Where("enabled = ?", true)
	}
	err := q.Order("id asc").Find(&list).Error
	return list, err
}

func GetMemberIdentityById(id int) (*MemberIdentity, error) {
	var m MemberIdentity
	err := DB.First(&m, id).Error
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// GetIdentityBoundPackages 返回各会员身份当前绑定的商品名 (recharge_packages.identity_id),
// key=identityId, value=该身份下的商品名列表. 供后台列表展示「已绑定商品」与删除校验复用.
func GetIdentityBoundPackages() (map[int][]string, error) {
	var rows []struct {
		IdentityId int
		Name       string
	}
	err := DB.Model(&RechargePackage{}).
		Select("identity_id, name").
		Where("identity_id > 0").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int][]string)
	for _, r := range rows {
		result[r.IdentityId] = append(result[r.IdentityId], r.Name)
	}
	return result, nil
}

func CreateMemberIdentity(m *MemberIdentity) error {
	if m.Name == "" {
		return errors.New("名称不能为空")
	}
	return DB.Create(m).Error
}

func UpdateMemberIdentity(m *MemberIdentity) error {
	if m.Id <= 0 {
		return errors.New("id 无效")
	}
	return DB.Model(m).Updates(map[string]interface{}{
		"name":          m.Name,
		"description":   m.Description,
		"package_level": m.PackageLevel,
		"enabled":       m.Enabled,
	}).Error
}

func DeleteMemberIdentity(id int) error {
	var count int64
	if err := DB.Model(&RechargePackage{}).Where("identity_id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return errors.New("该会员身份已绑定商品，请先解除绑定后再删除")
	}
	return DB.Delete(&MemberIdentity{}, id).Error
}

// GrantMemberIdentityToUser 按身份给用户创建订阅，days 为发放天数。
func GrantMemberIdentityToUser(userId, identityId, days int, source string) error {
	identity, err := GetMemberIdentityById(identityId)
	if err != nil {
		return errors.New("会员身份不存在")
	}
	if !identity.Enabled {
		return errors.New("会员身份已禁用")
	}
	if days <= 0 {
		return errors.New("天数必须大于 0")
	}

	now := time.Now()
	end := now.Add(time.Duration(days) * 24 * time.Hour)
	sub := &Subscription{
		UserId:             userId,
		PackageLevel:       identity.PackageLevel,
		BillingCycle:       "admin_grant",
		Status:             "active",
		QuotaPerPeriod:     0,
		PeriodsTotal:       1,
		PeriodsUsed:        0,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   end,
		SubscriptionEnd:    end,
		OrderNo:            source,
	}
	if err := DB.Create(sub).Error; err != nil {
		return err
	}

	// 写账户动态日志：会员时长变更需在「账户动态」中可见
	RecordLog(context.Background(), userId, LogTypeSystem,
		fmt.Sprintf("获得「%s」会员 %d 天", identity.Name, days))
	return nil
}
