package model

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common/random"
)

type OrgInvitation struct {
	Id         int        `json:"id" gorm:"primaryKey;comment:主键ID"`
	OrgId      int        `json:"org_id" gorm:"index;not null;comment:企业ID"`
	InviteCode string     `json:"invite_code" gorm:"type:varchar(32);uniqueIndex;not null;comment:邀请码"`
	InviterId  int        `json:"inviter_id" gorm:"not null;comment:邀请人用户ID"`
	Role       string     `json:"role" gorm:"type:varchar(20);default:'member';comment:邀请加入后的角色"`
	MaxUses    int        `json:"max_uses" gorm:"default:0;comment:最大使用次数 0=无限"`
	UsedCount  int        `json:"used_count" gorm:"default:0;comment:已使用次数"`
	ExpiredAt  *time.Time `json:"expired_at" gorm:"comment:过期时间"`
	CreatedAt  time.Time  `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
}

func (OrgInvitation) TableName() string {
	return "org_invitations"
}

func (inv *OrgInvitation) Insert() error {
	if inv.InviteCode == "" {
		inv.InviteCode = random.GetRandomString(16)
	}
	return DB.Create(inv).Error
}

func GetInvitationByCode(code string) (*OrgInvitation, error) {
	if code == "" {
		return nil, errors.New("邀请码为空")
	}
	var inv OrgInvitation
	err := DB.Where("invite_code = ?", code).First(&inv).Error
	return &inv, err
}

func GetOrgInvitations(orgId int) ([]*OrgInvitation, error) {
	var invitations []*OrgInvitation
	err := DB.Where("org_id = ?", orgId).Order("id desc").Find(&invitations).Error
	return invitations, err
}

func DeleteOrgInvitation(orgId int, code string) error {
	return DB.Where("org_id = ? AND invite_code = ?", orgId, code).Delete(&OrgInvitation{}).Error
}

func UseInvitation(code string, userId int) error {
	inv, err := GetInvitationByCode(code)
	if err != nil {
		return errors.New("无效的邀请码")
	}
	if inv.ExpiredAt != nil && inv.ExpiredAt.Before(time.Now()) {
		return errors.New("邀请码已过期")
	}
	if inv.MaxUses > 0 && inv.UsedCount >= inv.MaxUses {
		return errors.New("邀请码已达到使用上限")
	}
	// check if already a member of this org
	_, err = GetOrgMember(inv.OrgId, userId)
	if err == nil {
		return errors.New("你已经是该企业的成员")
	}
	// 拒绝来自其它企业的成员;需要先转出原企业再加入新企业
	target, err := GetUserById(userId, false)
	if err != nil {
		return err
	}
	if target.AccountType == AccountTypeEnterprise && target.OrgId != inv.OrgId {
		return errors.New("你已属于另一企业,无法使用本邀请码")
	}
	// check member limit
	count, err := GetOrgMemberCount(inv.OrgId)
	if err != nil {
		return err
	}
	org, err := GetOrgById(inv.OrgId)
	if err != nil {
		return err
	}
	if int(count) >= org.MaxMembers {
		return errors.New("企业成员数已达上限")
	}
	// 加入企业=身份切换:个人积分清零 + 写审计;adminId=0 表示由用户自助加入
	if err := TransferToEnterprise(0, userId, inv.OrgId, inv.Role, "通过邀请码加入"); err != nil {
		return err
	}
	// increment used count
	DB.Model(&OrgInvitation{}).Where("id = ?", inv.Id).Update("used_count", gorm.Expr("used_count + 1"))
	return nil
}
