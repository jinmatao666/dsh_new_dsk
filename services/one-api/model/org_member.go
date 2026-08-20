package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common/logger"
)

const (
	OrgMemberStatusEnabled  = 1
	OrgMemberStatusDisabled = 2
)

const (
	OrgRoleOwner  = "owner"
	OrgRoleAdmin  = "admin"
	OrgRoleMember = "member"
)

type OrgMember struct {
	Id         int       `json:"id" gorm:"primaryKey;comment:主键ID"`
	OrgId      int       `json:"org_id" gorm:"uniqueIndex:uk_org_user;index;not null;comment:企业ID"`
	UserId     int       `json:"user_id" gorm:"uniqueIndex:uk_org_user;index;not null;comment:用户ID"`
	Role       string    `json:"role" gorm:"type:varchar(20);default:'member';comment:角色 owner/admin/member"`
	DeptId     int       `json:"dept_id" gorm:"index;default:0;comment:所属部门ID 0=未分配"`
	QuotaLimit int64     `json:"quota_limit" gorm:"bigint;default:-1;comment:个人额度上限 -1表示不限制"`
	UsedQuota  int64     `json:"used_quota" gorm:"bigint;default:0;comment:该成员在企业内已使用额度"`
	Status     int       `json:"status" gorm:"default:1;comment:状态 1=正常 2=禁用"`
	JoinedAt   time.Time `json:"joined_at" gorm:"autoCreateTime;comment:加入时间"`
	Username   string    `json:"username" gorm:"-"`
}

func (OrgMember) TableName() string {
	return "org_members"
}

func GetOrgMember(orgId, userId int) (*OrgMember, error) {
	var member OrgMember
	err := DB.Where("org_id = ? AND user_id = ?", orgId, userId).First(&member).Error
	return &member, err
}

func GetOrgMembers(orgId int, startIdx, num int, keyword string) ([]*OrgMember, error) {
	members, _, err := GetOrgMembersWithCount(orgId, startIdx, num, keyword, "", "")
	return members, err
}

// orgMemberSortWhitelist 可排序列(均为 org_members 表字段,避免跨表 join).
var orgMemberSortWhitelist = map[string]string{
	"used_quota":  "used_quota",
	"quota_limit": "quota_limit",
	"joined_at":   "joined_at",
	"id":          "id",
}

// GetOrgMembersWithCount 分页返回企业成员并附带符合条件的总数(供前端分页).
// 用户名采用一次性批量查询 + 批量 overlay,避免逐条 GetUserById 的 N+1.
// sortBy 默认 used_quota(使用量),order 默认 desc;非白名单值回退到默认.
func GetOrgMembersWithCount(orgId int, startIdx, num int, keyword, sortBy, order string) ([]*OrgMember, int64, error) {
	var members []*OrgMember
	var total int64
	query := DB.Model(&OrgMember{}).Where("org_id = ?", orgId)
	if keyword != "" {
		var userIds []int
		DB.Model(&User{}).Where("username LIKE ?", "%"+keyword+"%").Pluck("id", &userIds)
		if len(userIds) == 0 {
			return members, 0, nil
		}
		query = query.Where("user_id IN ?", userIds)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	sortCol, ok := orgMemberSortWhitelist[sortBy]
	if !ok {
		sortCol = "used_quota" // 默认按使用量
	}
	orderDir := "desc"
	if order == "asc" {
		orderDir = "asc"
	}
	if err := query.Order(sortCol + " " + orderDir).Limit(num).Offset(startIdx).Find(&members).Error; err != nil {
		return nil, 0, err
	}
	if len(members) == 0 {
		return members, total, nil
	}
	// 批量取用户名:一次 IN 查询 + 一次身份 overlay,替代逐条 GetUserById
	ids := make([]int, 0, len(members))
	for _, m := range members {
		ids = append(ids, m.UserId)
	}
	var users []*User
	if err := getUserDB().Omit("password", "access_token").Where("id IN ?", ids).Find(&users).Error; err == nil {
		OverlayUsersIdentity(users)
		nameById := make(map[int]string, len(users))
		for _, u := range users {
			nameById[u.Id] = u.Username
		}
		for _, m := range members {
			m.Username = nameById[m.UserId]
		}
	}
	return members, total, nil
}

func GetOrgMemberCount(orgId int) (int64, error) {
	var count int64
	err := DB.Model(&OrgMember{}).Where("org_id = ? AND status = ?", orgId, OrgMemberStatusEnabled).Count(&count).Error
	return count, err
}

func GetUserOrgs(userId int) ([]*Organization, error) {
	var orgs []*Organization
	err := DB.Table("organizations").
		Joins("JOIN org_members ON org_members.org_id = organizations.id").
		Where("org_members.user_id = ? AND org_members.status = ?", userId, OrgMemberStatusEnabled).
		Find(&orgs).Error
	return orgs, err
}

func GetUserActiveOrg(userId int) (*Organization, *OrgMember, error) {
	var members []OrgMember
	err := DB.Where("user_id = ? AND status = ?", userId, OrgMemberStatusEnabled).Find(&members).Error
	if err != nil || len(members) == 0 {
		return nil, nil, nil
	}
	for _, member := range members {
		org, err := GetOrgById(member.OrgId)
		if err != nil || org.Status != OrgStatusEnabled {
			continue
		}
		// 可用余额以账本为唯一真相(GetOrgAvailableQuota),而非镜像列 quota-used_quota
		// (后者是跨事务维护的冗余,会漂移).计费链路也读账本,此处保持同源.
		avail, err := GetOrgAvailableQuota(org.Id)
		if err == nil && avail > 0 {
			m := member
			return org, &m, nil
		}
	}
	// 所有企业都没有剩余额度，返回第一个有效企业
	for _, member := range members {
		org, err := GetOrgById(member.OrgId)
		if err != nil || org.Status != OrgStatusEnabled {
			continue
		}
		m := member
		return org, &m, nil
	}
	return nil, nil, nil
}

func AddOrgMember(member *OrgMember) error {
	return DB.Create(member).Error
}

func RemoveOrgMember(orgId, userId int) error {
	return DB.Where("org_id = ? AND user_id = ?", orgId, userId).Delete(&OrgMember{}).Error
}

func (m *OrgMember) Update() error {
	return DB.Model(m).Updates(map[string]interface{}{
		"role":        m.Role,
		"quota_limit": m.QuotaLimit,
		"status":      m.Status,
	}).Error
}

func GetOrgMemberUsedQuota(orgId, userId int) (int64, error) {
	var usedQuota int64
	err := DB.Model(&OrgMember{}).Where("org_id = ? AND user_id = ?", orgId, userId).Select("used_quota").Find(&usedQuota).Error
	return usedQuota, err
}

func UpdateOrgMemberUsedQuota(orgId, userId int, quota int64) {
	err := DB.Model(&OrgMember{}).Where("org_id = ? AND user_id = ?", orgId, userId).
		Update("used_quota", gorm.Expr("used_quota + ?", quota)).Error
	if err != nil {
		logger.SysError("failed to update org member used quota: " + err.Error())
	}
}

func IsOrgAdmin(orgId, userId int) bool {
	member, err := GetOrgMember(orgId, userId)
	if err != nil {
		return false
	}
	return member.Role == OrgRoleOwner || member.Role == OrgRoleAdmin
}

func IsOrgOwner(orgId, userId int) bool {
	member, err := GetOrgMember(orgId, userId)
	if err != nil {
		return false
	}
	return member.Role == OrgRoleOwner
}

