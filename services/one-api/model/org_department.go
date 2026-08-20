package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

// OrgDepartment 是企业内部的部门(支持多级树状,parent_id=0 为顶级).
//   - QuotaCap 是部门累计用量上限(-1=不限);used_quota 在扣费 post-consume 时累加
//   - BudgetMode:
//       shared = 部门仅作组织/统计标签,quota_cap 为软提醒,不阻断扣费
//       capped = 强制 quota_cap,部门累计用量达上限后拒绝该部门成员继续消费
//   - 扣费资金始终来自企业总账本 org_timed_quotas;部门不持有独立资金池
type OrgDepartment struct {
	Id         int       `json:"id" gorm:"primaryKey"`
	OrgId      int       `json:"org_id" gorm:"index:idx_dept_org;not null;comment:所属企业"`
	ParentId   int       `json:"parent_id" gorm:"default:0;comment:父部门ID,0=顶级"`
	Name       string    `json:"name" gorm:"type:varchar(100);not null;comment:部门名称"`
	QuotaCap   int64     `json:"quota_cap" gorm:"type:bigint;default:-1;comment:部门累计用量上限 -1=不限"`
	UsedQuota  int64     `json:"used_quota" gorm:"type:bigint;default:0;comment:部门累计已用"`
	BudgetMode string    `json:"budget_mode" gorm:"type:varchar(16);default:'shared';comment:shared=软上限 capped=强制上限"`
	Status     int       `json:"status" gorm:"default:1;comment:1=正常 2=禁用"`
	Sort       int       `json:"sort" gorm:"default:0;comment:同级排序,小在前"`
	// 新成员加入/调入本部门时,若该成员尚无独立限额,则用以下默认值播种一条(-1=不限,0=禁用,>0=上限)
	DefaultDailyCap   int64     `json:"default_daily_cap" gorm:"type:bigint;default:-1;comment:新成员默认日限额 -1=不限"`
	DefaultMonthlyCap int64     `json:"default_monthly_cap" gorm:"type:bigint;default:-1;comment:新成员默认月限额 -1=不限"`
	CreatedAt         time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt         time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

func (OrgDepartment) TableName() string {
	return "org_departments"
}

const (
	OrgDeptStatusEnabled  = 1
	OrgDeptStatusDisabled = 2

	OrgDeptBudgetShared = "shared"
	OrgDeptBudgetCapped = "capped"
)

func normalizeBudgetMode(mode string) string {
	if mode == OrgDeptBudgetCapped {
		return OrgDeptBudgetCapped
	}
	return OrgDeptBudgetShared
}

// CreateOrgDepartment 新建部门.父部门必须属于同一企业.
func CreateOrgDepartment(orgId, parentId int, name, budgetMode string, quotaCap int64, sort int) (*OrgDepartment, error) {
	if orgId == 0 {
		return nil, errors.New("org_id 不能为空")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("部门名称不能为空")
	}
	if quotaCap < -1 {
		quotaCap = -1
	}
	if parentId != 0 {
		var parent OrgDepartment
		if err := DB.Where("id = ? AND org_id = ?", parentId, orgId).First(&parent).Error; err != nil {
			return nil, errors.New("父部门不存在或不属于该企业")
		}
	}
	dept := OrgDepartment{
		OrgId:      orgId,
		ParentId:   parentId,
		Name:       name,
		QuotaCap:   quotaCap,
		BudgetMode: normalizeBudgetMode(budgetMode),
		Status:     OrgDeptStatusEnabled,
		Sort:       sort,
	}
	if err := DB.Create(&dept).Error; err != nil {
		return nil, err
	}
	return &dept, nil
}

// UpdateOrgDepartment 更新部门基础字段.不允许把 parent 指向自身或自己的后代(防环).
func UpdateOrgDepartment(orgId, deptId, parentId int, name, budgetMode string, quotaCap int64, sort, status int) error {
	if deptId == 0 {
		return errors.New("dept_id 不能为空")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("部门名称不能为空")
	}
	if quotaCap < -1 {
		quotaCap = -1
	}
	var dept OrgDepartment
	if err := DB.Where("id = ? AND org_id = ?", deptId, orgId).First(&dept).Error; err != nil {
		return errors.New("部门不存在")
	}
	if parentId != 0 {
		if parentId == deptId {
			return errors.New("父部门不能是自己")
		}
		descendants, err := collectDescendantDeptIds(orgId, deptId)
		if err != nil {
			return err
		}
		if _, bad := descendants[parentId]; bad {
			return errors.New("父部门不能是自己的子部门")
		}
		var parent OrgDepartment
		if err := DB.Where("id = ? AND org_id = ?", parentId, orgId).First(&parent).Error; err != nil {
			return errors.New("父部门不存在或不属于该企业")
		}
	}
	return DB.Model(&OrgDepartment{}).Where("id = ? AND org_id = ?", deptId, orgId).
		Updates(map[string]interface{}{
			"parent_id":   parentId,
			"name":        name,
			"quota_cap":   quotaCap,
			"budget_mode": normalizeBudgetMode(budgetMode),
			"sort":        sort,
			"status":      status,
		}).Error
}

// collectDescendantDeptIds 返回 deptId 的全部后代部门 ID 集合(不含自身).
func collectDescendantDeptIds(orgId, deptId int) (map[int]struct{}, error) {
	all, err := GetOrgDepartments(orgId)
	if err != nil {
		return nil, err
	}
	childrenOf := map[int][]int{}
	for _, d := range all {
		childrenOf[d.ParentId] = append(childrenOf[d.ParentId], d.Id)
	}
	result := map[int]struct{}{}
	queue := append([]int{}, childrenOf[deptId]...)
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if _, seen := result[cur]; seen {
			continue
		}
		result[cur] = struct{}{}
		queue = append(queue, childrenOf[cur]...)
	}
	return result, nil
}

// DeleteOrgDepartment 删除部门.有子部门或仍有成员归属时拒绝,避免悬挂引用.
func DeleteOrgDepartment(orgId, deptId int) error {
	if deptId == 0 {
		return errors.New("dept_id 不能为空")
	}
	var childCount int64
	if err := DB.Model(&OrgDepartment{}).Where("org_id = ? AND parent_id = ?", orgId, deptId).Count(&childCount).Error; err != nil {
		return err
	}
	if childCount > 0 {
		return errors.New("请先删除或迁移子部门")
	}
	var memberCount int64
	if err := DB.Model(&OrgMember{}).Where("org_id = ? AND dept_id = ?", orgId, deptId).Count(&memberCount).Error; err != nil {
		return err
	}
	if memberCount > 0 {
		return errors.New("仍有成员归属该部门,请先调整成员部门")
	}
	return DB.Where("id = ? AND org_id = ?", deptId, orgId).Delete(&OrgDepartment{}).Error
}

// GetOrgDepartments 返回企业全部部门(按 sort, id 升序),前端自行拼树.
func GetOrgDepartments(orgId int) ([]OrgDepartment, error) {
	var rows []OrgDepartment
	err := DB.Where("org_id = ?", orgId).Order("sort asc, id asc").Find(&rows).Error
	return rows, err
}

// ResolveOrgDeptByPath 按名称路径查找**已有**部门,返回叶子部门 id;匹配不到返回 0(不创建).
// 支持分隔符 / 或 >,如 "研发部/前端组"。逐级用 (org_id, parent_id, name) 精确匹配,
// 名称前后空白会被裁剪。空路径返回 0(视为未分配)。
func ResolveOrgDeptByPath(orgId int, path string) (int, error) {
	segments := splitDeptPath(path)
	if len(segments) == 0 {
		return 0, nil
	}
	parentId := 0
	for _, name := range segments {
		var dept OrgDepartment
		err := DB.Where("org_id = ? AND parent_id = ? AND name = ?", orgId, parentId, name).
			First(&dept).Error
		if err != nil {
			return 0, nil // 任一级匹配不到,整体视为未找到
		}
		parentId = dept.Id
	}
	return parentId, nil
}

// splitDeptPath 把 "研发部/前端组" 或 "研发部>前端组" 拆成 ["研发部","前端组"],裁空白、丢空段.
func splitDeptPath(path string) []string {
	raw := strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '>' })
	out := make([]string, 0, len(raw))
	for _, s := range raw {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// GetOrgDeptMemberUserIds 返回某部门(含其所有子部门)下成员的 user_id 列表.
// 用于按部门维度筛选日志:日志表只有 org_id/user_id,无 dept_id,
// 因此先把部门子树映射成成员 user_ids,再用 user_id IN (...) 过滤.
func GetOrgDeptMemberUserIds(orgId, deptId int) ([]int, error) {
	descendants, err := collectDescendantDeptIds(orgId, deptId)
	if err != nil {
		return nil, err
	}
	deptIds := make([]int, 0, len(descendants)+1)
	deptIds = append(deptIds, deptId)
	for id := range descendants {
		deptIds = append(deptIds, id)
	}
	var userIds []int
	err = DB.Model(&OrgMember{}).
		Where("org_id = ? AND dept_id IN ?", orgId, deptIds).
		Pluck("user_id", &userIds).Error
	return userIds, err
}

// GetOrgDepartment 单个部门(校验归属企业).
func GetOrgDepartment(orgId, deptId int) (*OrgDepartment, error) {
	var dept OrgDepartment
	err := DB.Where("id = ? AND org_id = ?", deptId, orgId).First(&dept).Error
	if err != nil {
		return nil, err
	}
	return &dept, nil
}

// SetOrgDeptDefaultLimit 设置部门「新成员默认限额」.用 map 显式回写,保住"填 0=禁用"语义
// (default:-1 tag 会把结构体赋值的 0 当未赋值而覆盖成 -1).不影响已分配成员的现有限额.
func SetOrgDeptDefaultLimit(orgId, deptId int, dailyCap, monthlyCap int64) error {
	if deptId == 0 {
		return errors.New("dept_id 不能为空")
	}
	if dailyCap < -1 {
		dailyCap = -1
	}
	if monthlyCap < -1 {
		monthlyCap = -1
	}
	var dept OrgDepartment
	if err := DB.Where("id = ? AND org_id = ?", deptId, orgId).First(&dept).Error; err != nil {
		return errors.New("部门不存在")
	}
	return DB.Model(&OrgDepartment{}).Where("id = ? AND org_id = ?", deptId, orgId).
		Updates(map[string]interface{}{
			"default_daily_cap":   dailyCap,
			"default_monthly_cap": monthlyCap,
		}).Error
}

// ApplyOrgDeptDefaultLimit 成员被分配到 deptId 时,若该成员**尚无**独立限额,
// 则用部门默认值播种一条;已有显式限额的成员**绝不覆盖**.
//   - deptId=0(未分配)或部门两默认值均为 -1(不限) → no-op
//   - 仅在成员无 OrgMemberLimit 行时调用 SetOrgMemberLimit
func ApplyOrgDeptDefaultLimit(orgId, userId, deptId int) error {
	if deptId == 0 || userId == 0 {
		return nil
	}
	dept, err := GetOrgDepartment(orgId, deptId)
	if err != nil {
		return err
	}
	if dept.DefaultDailyCap == -1 && dept.DefaultMonthlyCap == -1 {
		return nil // 无默认限额,无需播种
	}
	existing, err := GetOrgMemberLimit(orgId, userId)
	if err != nil {
		return err
	}
	if existing != nil {
		return nil // 成员已有显式限额,不覆盖
	}
	return SetOrgMemberLimit(orgId, userId, dept.DefaultDailyCap, dept.DefaultMonthlyCap)
}

// getOrgDeptChain 返回从指定部门到根的链(leaf -> root).
// 用于扣费时逐级校验/累加 capped 祖先部门.含环保护(最多 32 级)。
func getOrgDeptChain(orgId, deptId int) ([]OrgDepartment, error) {
	var chain []OrgDepartment
	cur := deptId
	for i := 0; i < 32 && cur != 0; i++ {
		var d OrgDepartment
		if err := DB.Where("id = ? AND org_id = ?", cur, orgId).First(&d).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				break
			}
			return nil, err
		}
		chain = append(chain, d)
		cur = d.ParentId
	}
	return chain, nil
}

// IncrOrgDepartmentUsed 扣费 post-consume 时累加部门用量.失败仅记录(不阻断主链路).
func IncrOrgDepartmentUsed(tx *gorm.DB, deptId int, quota int64) error {
	if deptId == 0 || quota == 0 {
		return nil
	}
	db := tx
	if db == nil {
		db = DB
	}
	return db.Model(&OrgDepartment{}).Where("id = ?", deptId).
		Update("used_quota", gorm.Expr("used_quota + ?", quota)).Error
}

// DecrOrgDepartmentUsed 退款时把部门用量减回(不低于 0).
func DecrOrgDepartmentUsed(tx *gorm.DB, deptId int, quota int64) error {
	if deptId == 0 || quota <= 0 {
		return nil
	}
	db := tx
	if db == nil {
		db = DB
	}
	return db.Model(&OrgDepartment{}).Where("id = ?", deptId).
		Update("used_quota", greatestZeroExpr("used_quota", quota)).Error
}

// CheckOrgDeptBudget 在 pre-consume 校验该部门链路上的 capped 部门是否会超累计上限.
//   - deptId=0(未分配部门)直接放行
//   - 仅 budget_mode=capped 且 quota_cap>=0 的祖先部门参与拦截;shared 仅作标签
//   - 任一 capped 祖先 used+quota > cap 即拒绝
func CheckOrgDeptBudget(orgId, deptId int, quota int64) error {
	if deptId == 0 || quota <= 0 {
		return nil
	}
	chain, err := getOrgDeptChain(orgId, deptId)
	if err != nil {
		return err
	}
	for _, d := range chain {
		if d.Status == OrgDeptStatusDisabled {
			return errors.New("所属部门已被禁用")
		}
		if d.BudgetMode == OrgDeptBudgetCapped && d.QuotaCap >= 0 {
			if d.UsedQuota+quota > d.QuotaCap {
				return errors.New("超出部门「" + d.Name + "」预算上限")
			}
		}
	}
	return nil
}

// ApplyOrgDeptUsage 在 post-consume 把用量累加到部门链上每一级(含祖先).
//   - quota>0 累加,quota<0 退还
//   - 失败仅由调用方记日志,不阻断主链路
func ApplyOrgDeptUsage(tx *gorm.DB, orgId, deptId int, quota int64) error {
	if deptId == 0 || quota == 0 {
		return nil
	}
	chain, err := getOrgDeptChain(orgId, deptId)
	if err != nil {
		return err
	}
	db := tx
	if db == nil {
		db = DB
	}
	for _, d := range chain {
		if quota > 0 {
			if err := IncrOrgDepartmentUsed(db, d.Id, quota); err != nil {
				return err
			}
		} else {
			if err := DecrOrgDepartmentUsed(db, d.Id, -quota); err != nil {
				return err
			}
		}
	}
	return nil
}
