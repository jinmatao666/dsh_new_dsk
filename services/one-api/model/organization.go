package model

import (
	"errors"
	"time"
)

const (
	OrgStatusEnabled  = 1
	OrgStatusDisabled = 2
)

type Organization struct {
	Id           int       `json:"id" gorm:"primaryKey;comment:主键ID"`
	Name         string    `json:"name" gorm:"type:varchar(100);not null;comment:企业名称"`
	Code         string    `json:"code" gorm:"type:varchar(32);uniqueIndex;not null;comment:企业唯一编码"`
	OwnerId      int       `json:"owner_id" gorm:"index;not null;comment:创建者用户ID"`
	Status       int       `json:"status" gorm:"default:1;comment:状态"`
	Group        string    `json:"group" gorm:"type:varchar(32);default:'default';comment:绑定的计费分组"`
	Quota        int64     `json:"quota" gorm:"bigint;default:0;comment:企业总额度"`
	UsedQuota    int64     `json:"used_quota" gorm:"bigint;default:0;comment:已使用额度"`
	MaxMembers   int       `json:"max_members" gorm:"default:50;comment:最大成员数"`
	Discount     int       `json:"discount" gorm:"default:100;comment:充值折扣率百分比 100=原价 90=9折"`
	BillingEmail string    `json:"billing_email" gorm:"type:varchar(128);comment:财务联系邮箱"`
	TaxNum       string    `json:"tax_num" gorm:"type:varchar(64);comment:企业税号"`
	LoginUsername string    `json:"login_username" gorm:"type:varchar(64);uniqueIndex;comment:企业登录用户名"`
	LoginPassword string    `json:"-" gorm:"type:varchar(128);comment:企业登录密码"`
	CreatedAt     time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt     time.Time `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
}

func (Organization) TableName() string {
	return "organizations"
}

func GetOrgById(id int) (*Organization, error) {
	if id == 0 {
		return nil, errors.New("org id 为空")
	}
	var org Organization
	err := DB.Where("id = ?", id).First(&org).Error
	return &org, err
}

func GetOrgByCode(code string) (*Organization, error) {
	if code == "" {
		return nil, errors.New("org code 为空")
	}
	var org Organization
	err := DB.Where("code = ?", code).First(&org).Error
	return &org, err
}

func GetAllOrganizations(startIdx int, num int) ([]*Organization, error) {
	var orgs []*Organization
	err := DB.Order("id desc").Limit(num).Offset(startIdx).Find(&orgs).Error
	return orgs, err
}

func SearchOrganizations(keyword string) ([]*Organization, error) {
	var orgs []*Organization
	err := DB.Where("name LIKE ? OR code LIKE ?", keyword+"%", keyword+"%").Find(&orgs).Error
	return orgs, err
}

// OrgWithQuota 在企业基础信息上附带账本口径的额度三值(未过期批次聚合).
// 列表页展示用,与成员设置/org-admin 概览同源,避免镜像列 quota/used_quota 漂移.
type OrgWithQuota struct {
	*Organization
	ValidTotal int64 `json:"valid_total"` // 未过期 SUM(amount)
	Available  int64 `json:"available"`   // 未过期且 remaining>0 SUM(remaining)
	Used       int64 `json:"used"`        // valid_total - available
}

// AttachOrgQuotaSummary 给一批企业附带账本口径额度三值.
// 只做一条 GROUP BY 聚合(而非逐企业查询),避免 N+1.账本无行的企业三值为 0.
func AttachOrgQuotaSummary(orgs []*Organization) ([]*OrgWithQuota, error) {
	out := make([]*OrgWithQuota, 0, len(orgs))
	if len(orgs) == 0 {
		return out, nil
	}
	ids := make([]int, 0, len(orgs))
	for _, o := range orgs {
		ids = append(ids, o.Id)
	}
	type agg struct {
		OrgId      int
		ValidTotal int64
		Available  int64
	}
	var aggs []agg
	// 未过期批次:valid_total = SUM(amount);available = SUM(remaining WHERE remaining>0).
	// 用 CASE 让两列在同一次扫描里算出.
	err := DB.Model(&OrgTimedQuota{}).
		Select("org_id, "+
			"COALESCE(SUM(amount), 0) AS valid_total, "+
			"COALESCE(SUM(CASE WHEN remaining > 0 THEN remaining ELSE 0 END), 0) AS available").
		Where("org_id IN ? AND (expires_at IS NULL OR expires_at > ?)", ids, time.Now()).
		Group("org_id").
		Scan(&aggs).Error
	if err != nil {
		return nil, err
	}
	byOrg := make(map[int]agg, len(aggs))
	for _, a := range aggs {
		byOrg[a.OrgId] = a
	}
	for _, o := range orgs {
		a := byOrg[o.Id]
		out = append(out, &OrgWithQuota{
			Organization: o,
			ValidTotal:   a.ValidTotal,
			Available:    a.Available,
			Used:         a.ValidTotal - a.Available,
		})
	}
	return out, nil
}

func (org *Organization) Insert() error {
	return DB.Create(org).Error
}

func (org *Organization) Update() error {
	return DB.Model(org).Select("name", "status", "group", "max_members", "billing_email", "tax_num", "login_username", "discount").Updates(org).Error
}

func (org *Organization) Delete() error {
	return DB.Delete(org).Error
}

// 注意:与积分扣减/充值相关的能力已统一切到 org_timed_quotas 账本.
//   - 充值: AddOrgTimedQuota
//   - 扣费: DecreaseOrgQuotaByLedger
//   - 退款: RefundOrgQuotaByLedger
//   - 过期: ExpireOrgTimedQuotas
//   - 余额: GetOrgAvailableQuota / GetOrgTimedQuotaBreakdown
// organizations.quota / used_quota 仅作为只读镜像列存在,供历史 SQL/报表使用.

func GetOrgByLoginUsername(username string) (*Organization, error) {
	if username == "" {
		return nil, errors.New("login username 为空")
	}
	var org Organization
	err := DB.Where("login_username = ?", username).First(&org).Error
	return &org, err
}

func UpdateOrgPassword(orgId int, hashedPassword string) error {
	return DB.Model(&Organization{}).Where("id = ?", orgId).Update("login_password", hashedPassword).Error
}
