package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// 本文件是企业自助端(/org-api, 3001 端口)的部门/成员限额/审计处理器.
// 与 air 平台管理端(controller/org_department.go)能力对等,但:
//   - orgId 一律从 JWT 取(c.GetInt("org_id")),天生只能操作自己企业,无越权
//   - 审计操作人记企业自身(JWT 无具体子账号),actor_id=0 / actor_name=org_name
//   - model 层完全复用,不重复实现业务逻辑

// auditOrgPortal 企业自助端审计:操作人记企业自身.best-effort,失败仅记日志.
func auditOrgPortal(c *gin.Context, action, targetType string, targetId int, detail interface{}) {
	orgId := c.GetInt("org_id")
	orgName := c.GetString("org_name")
	if err := model.WriteOrgAuditLog(orgId, 0, orgName, action, targetType, targetId, detail, c.ClientIP()); err != nil {
		logger.SysErrorf("写企业审计失败 org=%d action=%s: %v", orgId, action, err)
	}
}

// OrgPortalGetDepartments 返回本企业全部部门(平铺,前端拼树).
func OrgPortalGetDepartments(c *gin.Context) {
	orgId := c.GetInt("org_id")
	depts, err := model.GetOrgDepartments(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": depts})
}

// OrgPortalCreateDepartment 新建部门.
func OrgPortalCreateDepartment(c *gin.Context) {
	orgId := c.GetInt("org_id")
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
	auditOrgPortal(c, model.OrgAuditActionDeptCreate, model.OrgAuditTargetDepartment, dept.Id, gin.H{
		"name": dept.Name, "parent_id": dept.ParentId, "budget_mode": dept.BudgetMode, "quota_cap": dept.QuotaCap,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": dept})
}

// OrgPortalUpdateDepartment 更新部门.
func OrgPortalUpdateDepartment(c *gin.Context) {
	orgId := c.GetInt("org_id")
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
	auditOrgPortal(c, model.OrgAuditActionDeptUpdate, model.OrgAuditTargetDepartment, deptId, gin.H{
		"name": req.Name, "parent_id": req.ParentId, "budget_mode": req.BudgetMode, "quota_cap": req.QuotaCap, "status": req.Status,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// OrgPortalDeleteDepartment 删除部门(有子部门或成员时拒绝).
func OrgPortalDeleteDepartment(c *gin.Context) {
	orgId := c.GetInt("org_id")
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
	auditOrgPortal(c, model.OrgAuditActionDeptDelete, model.OrgAuditTargetDepartment, deptId, gin.H{"name": deptName})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// OrgPortalSetMemberDept 调整成员部门归属(dept_id=0 表示移出部门).
func OrgPortalSetMemberDept(c *gin.Context) {
	orgId := c.GetInt("org_id")
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
	// 调入部门后,若成员尚无独立限额,用部门默认限额播种一条(best-effort,不阻断主流程).
	if req.DeptId != 0 {
		if err := model.ApplyOrgDeptDefaultLimit(orgId, targetUserId, req.DeptId); err != nil {
			logger.SysErrorf("应用部门默认限额失败 org=%d user=%d dept=%d: %v", orgId, targetUserId, req.DeptId, err)
		}
	}
	auditOrgPortal(c, model.OrgAuditActionMemberSetDept, model.OrgAuditTargetMember, targetUserId, gin.H{"dept_id": req.DeptId})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// OrgPortalGetMemberLimits 返回本企业全部成员限额(user_id -> limit).
func OrgPortalGetMemberLimits(c *gin.Context) {
	orgId := c.GetInt("org_id")
	limits, err := model.GetOrgMemberLimits(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": limits})
}

// OrgPortalSetMemberLimit upsert 单个成员的日/月限额(-1=不限 0=禁用 >0=上限).
func OrgPortalSetMemberLimit(c *gin.Context) {
	orgId := c.GetInt("org_id")
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
	auditOrgPortal(c, model.OrgAuditActionMemberLimit, model.OrgAuditTargetMember, targetUserId, gin.H{
		"daily_cap": dailyCap, "monthly_cap": monthlyCap,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// OrgPortalBatchSetMemberLimit 批量设置多个成员的日/月限额(语义同单个:-1=不限 0=禁用 >0=上限).
func OrgPortalBatchSetMemberLimit(c *gin.Context) {
	orgId := c.GetInt("org_id")
	var req struct {
		UserIds    []int  `json:"user_ids"`
		DailyCap   *int64 `json:"daily_cap"`
		MonthlyCap *int64 `json:"monthly_cap"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if len(req.UserIds) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请至少选择一个成员"})
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
	successCount := 0
	for _, uid := range req.UserIds {
		if _, err := model.GetOrgMember(orgId, uid); err != nil {
			continue // 跳过非本企业成员
		}
		if err := model.SetOrgMemberLimit(orgId, uid, dailyCap, monthlyCap); err != nil {
			logger.SysErrorf("批量设限失败 org=%d user=%d: %v", orgId, uid, err)
			continue
		}
		successCount++
	}
	auditOrgPortal(c, model.OrgAuditActionMemberLimit, model.OrgAuditTargetMember, 0, gin.H{
		"user_ids": req.UserIds, "daily_cap": dailyCap, "monthly_cap": monthlyCap, "batch": true,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"success_count": successCount,
		"total":         len(req.UserIds),
	}})
}

// OrgPortalSetDeptDefaultLimit 设置部门「新成员默认限额」.仅影响后续加入/调入且无独立限额的成员.
func OrgPortalSetDeptDefaultLimit(c *gin.Context) {
	orgId := c.GetInt("org_id")
	deptId, err := strconv.Atoi(c.Param("deptId"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的部门ID"})
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
	if _, err := model.GetOrgDepartment(orgId, deptId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "部门不存在"})
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
	if err := model.SetOrgDeptDefaultLimit(orgId, deptId, dailyCap, monthlyCap); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrgPortal(c, model.OrgAuditActionDeptDefaultLimit, model.OrgAuditTargetDepartment, deptId, gin.H{
		"daily_cap": dailyCap, "monthly_cap": monthlyCap,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// OrgPortalGetAuditLogs 分页查询本企业操作审计(只读).支持 action 过滤.
func OrgPortalGetAuditLogs(c *gin.Context) {
	orgId := c.GetInt("org_id")
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
