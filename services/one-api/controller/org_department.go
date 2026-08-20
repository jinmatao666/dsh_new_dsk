package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// requireOrgAdmin 复用各 org 接口的鉴权:平台管理员或本企业管理员放行.
// 返回 (orgId, ok);ok=false 时已写好响应.
func requireOrgAdmin(c *gin.Context) (int, bool) {
	orgId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return 0, false
	}
	userId := c.GetInt("id")
	role, _ := c.Get("role")
	userRole, _ := role.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return 0, false
	}
	return orgId, true
}

// auditOrg 写一条企业操作审计.best-effort:失败仅记日志,不影响主流程响应.
func auditOrg(c *gin.Context, orgId int, action, targetType string, targetId int, detail interface{}) {
	actorId := c.GetInt("id")
	actorName := c.GetString("username")
	if err := model.WriteOrgAuditLog(orgId, actorId, actorName, action, targetType, targetId, detail, c.ClientIP()); err != nil {
		logger.SysErrorf("写企业审计失败 org=%d action=%s: %v", orgId, action, err)
	}
}

// GetOrgDepartments 返回企业全部部门(平铺,前端拼树).
func GetOrgDepartments(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	depts, err := model.GetOrgDepartments(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": depts})
}

// CreateOrgDepartment 新建部门.
func CreateOrgDepartment(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	var req struct {
		ParentId   int    `json:"parent_id"`
		Name       string `json:"name"`
		BudgetMode string `json:"budget_mode"`
		QuotaCap   int64  `json:"quota_cap"`
		Sort       int    `json:"sort"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.QuotaCap == 0 {
		req.QuotaCap = -1
	}
	dept, err := model.CreateOrgDepartment(orgId, req.ParentId, req.Name, req.BudgetMode, req.QuotaCap, req.Sort)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionDeptCreate, model.OrgAuditTargetDepartment, dept.Id, gin.H{
		"name": dept.Name, "parent_id": dept.ParentId, "budget_mode": dept.BudgetMode, "quota_cap": dept.QuotaCap,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": dept})
}

// UpdateOrgDepartment 更新部门.
func UpdateOrgDepartment(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	deptId, err := strconv.Atoi(c.Param("deptId"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的部门ID"})
		return
	}
	var req struct {
		ParentId   int    `json:"parent_id"`
		Name       string `json:"name"`
		BudgetMode string `json:"budget_mode"`
		QuotaCap   int64  `json:"quota_cap"`
		Sort       int    `json:"sort"`
		Status     int    `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Status == 0 {
		req.Status = model.OrgDeptStatusEnabled
	}
	if req.QuotaCap == 0 {
		req.QuotaCap = -1
	}
	if err := model.UpdateOrgDepartment(orgId, deptId, req.ParentId, req.Name, req.BudgetMode, req.QuotaCap, req.Sort, req.Status); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionDeptUpdate, model.OrgAuditTargetDepartment, deptId, gin.H{
		"name": req.Name, "parent_id": req.ParentId, "budget_mode": req.BudgetMode, "quota_cap": req.QuotaCap, "status": req.Status,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// DeleteOrgDepartment 删除部门(有子部门或成员时拒绝).
func DeleteOrgDepartment(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	deptId, err := strconv.Atoi(c.Param("deptId"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的部门ID"})
		return
	}
	var deptName string
	if d, e := model.GetOrgDepartment(orgId, deptId); e == nil {
		deptName = d.Name
	}
	if err := model.DeleteOrgDepartment(orgId, deptId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionDeptDelete, model.OrgAuditTargetDepartment, deptId, gin.H{"name": deptName})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// SetOrgMemberDept 调整成员部门归属(dept_id=0 表示移出部门).
func SetOrgMemberDept(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	targetUserId, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	var req struct {
		DeptId int `json:"dept_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if _, err := model.GetOrgMember(orgId, targetUserId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该用户不是企业成员"})
		return
	}
	if req.DeptId != 0 {
		if _, err := model.GetOrgDepartment(orgId, req.DeptId); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "目标部门不存在"})
			return
		}
	}
	if err := model.DB.Model(&model.OrgMember{}).
		Where("org_id = ? AND user_id = ?", orgId, targetUserId).
		Update("dept_id", req.DeptId).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionMemberSetDept, model.OrgAuditTargetMember, targetUserId, gin.H{"dept_id": req.DeptId})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// GetOrgMemberLimits 返回企业全部成员限额(user_id -> limit),前端与成员表合并展示.
func GetOrgMemberLimits(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	limits, err := model.GetOrgMemberLimits(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": limits})
}

// SetOrgMemberLimit upsert 单个成员的日/月限额.
func SetOrgMemberLimit(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	targetUserId, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	var req struct {
		DailyCap   *int64 `json:"daily_cap"`
		MonthlyCap *int64 `json:"monthly_cap"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if _, err := model.GetOrgMember(orgId, targetUserId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该用户不是企业成员"})
		return
	}
	dailyCap := int64(-1)
	monthlyCap := int64(-1)
	if req.DailyCap != nil {
		dailyCap = *req.DailyCap
	}
	if req.MonthlyCap != nil {
		monthlyCap = *req.MonthlyCap
	}
	if err := model.SetOrgMemberLimit(orgId, targetUserId, dailyCap, monthlyCap); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionMemberLimit, model.OrgAuditTargetMember, targetUserId, gin.H{
		"daily_cap": dailyCap, "monthly_cap": monthlyCap,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// GetOrgAuditLogs 分页查询企业管理操作审计.支持 action 过滤.
func GetOrgAuditLogs(c *gin.Context) {
	orgId, ok := requireOrgAdmin(c)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	action := c.Query("action")
	rows, total, err := model.GetOrgAuditLogs(orgId, action, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"items": rows,
		"total": total,
	}})
}
