package model

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

// OrgAuditLog 记录企业管理操作审计.与 Log(用量计费)/AccountTypeChange(账户迁移)互不重叠:
//   - 这里只记"谁在企业里做了什么管理动作",如建部门/调限额/充值
//   - Detail 存操作前后关键字段的 JSON 快照,供事后排查
//   - 写入失败不应阻塞主操作:调用方记日志后继续(best-effort 审计)
type OrgAuditLog struct {
	Id         int64     `json:"id" gorm:"primaryKey"`
	OrgId      int       `json:"org_id" gorm:"index;not null;comment:企业ID"`
	ActorId    int       `json:"actor_id" gorm:"index;not null;comment:操作者用户ID;0=系统"`
	ActorName  string    `json:"actor_name" gorm:"type:varchar(64);comment:操作者用户名快照"`
	Action     string    `json:"action" gorm:"type:varchar(48);index;not null;comment:动作类型"`
	TargetType string    `json:"target_type" gorm:"type:varchar(32);comment:目标类型 department/member/quota"`
	TargetId   int       `json:"target_id" gorm:"default:0;comment:目标对象ID"`
	Detail     string    `json:"detail" gorm:"type:text;comment:JSON 详情快照"`
	Ip         string    `json:"ip" gorm:"type:varchar(64);comment:操作者IP"`
	CreatedAt  time.Time `json:"created_at" gorm:"autoCreateTime;index"`
}

func (OrgAuditLog) TableName() string {
	return "org_audit_logs"
}

// 审计动作常量.前端 EVENT_LABELS 风格,统一中文展示由前端映射.
const (
	OrgAuditActionDeptCreate    = "dept_create"
	OrgAuditActionDeptUpdate    = "dept_update"
	OrgAuditActionDeptDelete    = "dept_delete"
	OrgAuditActionMemberSetDept = "member_set_dept"
	OrgAuditActionMemberLimit   = "member_set_limit"
	OrgAuditActionMemberAdd     = "member_add"
	OrgAuditActionMemberUpdate  = "member_update"
	OrgAuditActionMemberRemove  = "member_remove"
	OrgAuditActionQuotaTopup    = "quota_topup"
	OrgAuditActionDeptDefaultLimit = "dept_default_limit"
)

// 目标类型常量.
const (
	OrgAuditTargetDepartment = "department"
	OrgAuditTargetMember     = "member"
	OrgAuditTargetQuota      = "quota"
)

// WriteOrgAuditLog 写一条企业操作审计.detail 任意可序列化对象,内部 marshal 为 JSON.
//   - best-effort:返回的 error 由调用方记日志,不应回滚主操作
//   - detail 序列化失败时退化为空字符串,不阻塞写入
func WriteOrgAuditLog(orgId, actorId int, actorName, action, targetType string, targetId int, detail interface{}, ip string) error {
	if orgId == 0 {
		return errors.New("org_id 不能为空")
	}
	if action == "" {
		return errors.New("action 不能为空")
	}
	detailStr := ""
	if detail != nil {
		if b, err := json.Marshal(detail); err == nil {
			detailStr = string(b)
		}
	}
	row := OrgAuditLog{
		OrgId:      orgId,
		ActorId:    actorId,
		ActorName:  actorName,
		Action:     action,
		TargetType: targetType,
		TargetId:   targetId,
		Detail:     detailStr,
		Ip:         ip,
	}
	return DB.Create(&row).Error
}

// GetOrgAuditLogs 分页查询企业审计日志,按时间倒序.可选 action 过滤.
//   - page 从 1 起;pageSize 上限 100
//   - 返回 (rows, total)
func GetOrgAuditLogs(orgId int, action string, page, pageSize int) ([]OrgAuditLog, int64, error) {
	if orgId == 0 {
		return nil, 0, errors.New("org_id 不能为空")
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	q := DB.Model(&OrgAuditLog{}).Where("org_id = ?", orgId)
	if action != "" {
		q = q.Where("action = ?", action)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []OrgAuditLog
	err := q.Order("id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&rows).Error
	return rows, total, err
}

// DeleteOrgAuditLogsByOrg 企业被删除时清理其审计日志.
func DeleteOrgAuditLogsByOrg(tx *gorm.DB, orgId int) error {
	db := tx
	if db == nil {
		db = DB
	}
	return db.Where("org_id = ?", orgId).Delete(&OrgAuditLog{}).Error
}
