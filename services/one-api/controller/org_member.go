package controller

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/model"
)

func GetOrgMembers(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	userId := c.GetInt("id")
	role, _ := c.Get("role")
	userRole, _ := role.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	members, err := model.GetOrgMembers(orgId, p*10, 10, "")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": members})
}

func AddOrgMember(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	userId := c.GetInt("id")
	userRoleVal, _ := c.Get("role")
	userRole, _ := userRoleVal.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	var req struct {
		UserId   int    `json:"user_id"`
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	targetUserId := req.UserId
	if targetUserId == 0 && req.Username != "" {
		user, err := model.GetUserByUsername(req.Username)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户不存在"})
			return
		}
		targetUserId = user.Id
	}
	if targetUserId == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请提供 user_id 或 username"})
		return
	}
	// 校验目标用户当前不在其它企业中(企业身份单值,需要先 transfer-to-personal 才能换企业)
	target, err := model.GetUserById(targetUserId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	if target.AccountType == model.AccountTypeEnterprise && target.OrgId != orgId {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该用户已属于另一企业,请先将其转出"})
		return
	}
	// check member limit
	count, _ := model.GetOrgMemberCount(orgId)
	org, _ := model.GetOrgById(orgId)
	if org != nil && int(count) >= org.MaxMembers {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业成员数已达上限"})
		return
	}
	role := req.Role
	if role == "" {
		role = model.OrgRoleMember
	}
	// 添加成员=身份切换:个人积分清零 + 取消订阅 + 写审计;
	// 已是本企业成员时 TransferToEnterprise 会拒绝,前端走"修改角色"接口处理.
	if err := model.TransferToEnterprise(userId, targetUserId, orgId, role, "添加为企业成员"); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "添加失败: " + err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionMemberAdd, model.OrgAuditTargetMember, targetUserId, gin.H{"role": role})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func BatchAddOrgMembers(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	userId := c.GetInt("id")
	userRoleVal, _ := c.Get("role")
	userRole, _ := userRoleVal.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	var req struct {
		UserIds []int  `json:"user_ids"`
		Role    string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if len(req.UserIds) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "user_ids 不能为空"})
		return
	}
	role := req.Role
	if role == "" {
		role = model.OrgRoleMember
	}
	successCount := 0
	for _, uid := range req.UserIds {
		if err := model.TransferToEnterprise(userId, uid, orgId, role, "批量加入企业"); err == nil {
			successCount++
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"success_count": successCount, "total": len(req.UserIds)}})
}

func UpdateOrgMember(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	targetUserIdStr := c.Param("userId")
	targetUserId, err := strconv.Atoi(targetUserIdStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	userId := c.GetInt("id")
	role, _ := c.Get("role")
	userRole, _ := role.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	member, err := model.GetOrgMember(orgId, targetUserId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该用户不是企业成员"})
		return
	}
	var req struct {
		Role       *string `json:"role"`
		QuotaLimit *int64  `json:"quota_limit"`
		Status     *int    `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Role != nil {
		member.Role = *req.Role
	}
	if req.QuotaLimit != nil {
		member.QuotaLimit = *req.QuotaLimit
	}
	if req.Status != nil {
		member.Status = *req.Status
	}
	err = member.Update()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionMemberUpdate, model.OrgAuditTargetMember, targetUserId, gin.H{
		"role": member.Role, "quota_limit": member.QuotaLimit, "status": member.Status,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func RemoveOrgMember(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	targetUserIdStr := c.Param("userId")
	targetUserId, err := strconv.Atoi(targetUserIdStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	userId := c.GetInt("id")
	role, _ := c.Get("role")
	userRole, _ := role.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	if model.IsOrgOwner(orgId, targetUserId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "不能移除企业所有者"})
		return
	}
	// 校验目标用户确实是该企业成员(避免错误地把别家企业的人转出)
	target, err := model.GetUserById(targetUserId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	if target.AccountType != model.AccountTypeEnterprise || target.OrgId != orgId {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该用户不属于本企业"})
		return
	}
	// 移除成员=转出为个体身份;企业范围已由中间件鉴权,不再要求平台管理员密码
	if err := model.TransferToPersonal(userId, targetUserId, "由企业 "+idStr+" 移除"); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	auditOrg(c, orgId, model.OrgAuditActionMemberRemove, model.OrgAuditTargetMember, targetUserId, nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// Invitation management

func CreateOrgInvitation(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	userId := c.GetInt("id")
	userRoleVal, _ := c.Get("role")
	userRole, _ := userRoleVal.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	var req struct {
		Role      string `json:"role"`
		MaxUses   int    `json:"max_uses"`
		ExpireDays int   `json:"expire_days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	role := req.Role
	if role == "" {
		role = model.OrgRoleMember
	}
	inv := &model.OrgInvitation{
		OrgId:     orgId,
		InviterId: userId,
		Role:      role,
		MaxUses:   req.MaxUses,
	}
	if req.ExpireDays > 0 {
		expiredAt := time.Now().AddDate(0, 0, req.ExpireDays)
		inv.ExpiredAt = &expiredAt
	}
	err = inv.Insert()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": inv})
}

func GetOrgInvitations(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	userId := c.GetInt("id")
	role, _ := c.Get("role")
	userRole, _ := role.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	invitations, err := model.GetOrgInvitations(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": invitations})
}

func DeleteOrgInvitation(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	code := c.Param("code")
	userId := c.GetInt("id")
	role, _ := c.Get("role")
	userRole, _ := role.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	err = model.DeleteOrgInvitation(orgId, code)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func JoinOrganization(c *gin.Context) {
	var req struct {
		InviteCode string `json:"invite_code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.InviteCode == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请提供邀请码"})
		return
	}
	userId := c.GetInt("id")
	err := model.UseInvitation(req.InviteCode, userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "加入成功"})
}

// orgImportRow 是批量导入的单行(由前端解析 Excel/CSV 后传入).
type orgImportRow struct {
	EmployeeNo string `json:"employee_no"`
	Name       string `json:"name"`
	Dept       string `json:"dept"`
}

// orgImportResult 单行导入结果,用于前端逐行展示成败.
type orgImportResult struct {
	Row        int    `json:"row"`         // 1-based 行号
	Username   string `json:"username"`    // 实际生成的用户名
	Name       string `json:"name"`        // display_name
	Dept       string `json:"dept"`        // 原始部门路径
	DeptId     int    `json:"dept_id"`     // 解析到的部门 id,0=未分配
	Success    bool   `json:"success"`
	Message    string `json:"message"`     // 失败原因或提示(如"部门未匹配")
}

// importOrgMembersCore 批量导入企业成员的共享实现(air 后台 + 企业门户共用).
//   - adminId:操作者(写审计用)
//   - 用户名 = prefix + employee_no(无工号则 prefix + 行号),密码 = passwordPrefix + 用户名
//   - dept 按名称路径解析**已有**部门,匹配不到则该成员留未分配并在结果中提示
func importOrgMembersCore(adminId, orgId int, prefix, passwordPrefix, role string, rows []orgImportRow) []orgImportResult {
	if role == "" {
		role = model.OrgRoleMember
	}
	results := make([]orgImportResult, 0, len(rows))
	for i, r := range rows {
		rowNo := i + 1
		empNo := strings.TrimSpace(r.EmployeeNo)
		suffix := empNo
		if suffix == "" {
			suffix = strconv.Itoa(rowNo)
		}
		username := prefix + suffix
		name := strings.TrimSpace(r.Name)
		if name == "" {
			name = username
		}
		res := orgImportResult{Row: rowNo, Username: username, Name: name, Dept: strings.TrimSpace(r.Dept)}

		user := &model.User{
			Username:    username,
			Password:    passwordPrefix + username,
			DisplayName: name,
			Role:        model.RoleCommonUser,
			Status:      model.UserStatusEnabled,
		}
		if err := user.Insert(context.Background(), 0); err != nil {
			res.Message = "创建账号失败: " + err.Error()
			results = append(results, res)
			continue
		}
		if err := model.TransferToEnterprise(adminId, user.Id, orgId, role, "批量导入企业成员"); err != nil {
			res.Message = "转入企业失败: " + err.Error()
			results = append(results, res)
			continue
		}
		// 解析部门(仅匹配已有);匹配到才落 dept_id
		if res.Dept != "" {
			deptId, err := model.ResolveOrgDeptByPath(orgId, res.Dept)
			if err != nil {
				res.Message = "部门解析出错: " + err.Error()
			} else if deptId == 0 {
				res.Message = "部门未匹配,已设为未分配"
			} else {
				if uerr := model.DB.Model(&model.OrgMember{}).
					Where("org_id = ? AND user_id = ?", orgId, user.Id).
					Update("dept_id", deptId).Error; uerr != nil {
					res.Message = "部门设置失败: " + uerr.Error()
				} else {
					res.DeptId = deptId
				}
			}
		}
		res.Success = true
		results = append(results, res)
	}
	return results
}

// bindImportRequest 解析批量导入请求体,校验前缀与行数.
func bindImportRequest(c *gin.Context) (prefix, passwordPrefix, role string, rows []orgImportRow, ok bool) {
	var req struct {
		Prefix         string         `json:"prefix"`
		PasswordPrefix string         `json:"password_prefix"`
		Role           string         `json:"role"`
		Rows           []orgImportRow `json:"rows"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Prefix == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "账号前缀不能为空"})
		return
	}
	if len(req.Rows) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "导入数据为空"})
		return
	}
	if len(req.Rows) > 500 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "单次导入不超过500条"})
		return
	}
	return req.Prefix, req.PasswordPrefix, req.Role, req.Rows, true
}

// BatchImportOrgMembers air 后台:从解析后的花名册批量导入企业成员.
func BatchImportOrgMembers(c *gin.Context) {
	orgId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	userId := c.GetInt("id")
	userRoleVal, _ := c.Get("role")
	userRole, _ := userRoleVal.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	prefix, passwordPrefix, role, rows, ok := bindImportRequest(c)
	if !ok {
		return
	}
	results := importOrgMembersCore(userId, orgId, prefix, passwordPrefix, role, rows)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": summarizeImport(results)})
}

// summarizeImport 汇总导入结果:成功/失败计数 + 逐行明细.
func summarizeImport(results []orgImportResult) gin.H {
	successCount := 0
	for _, r := range results {
		if r.Success {
			successCount++
		}
	}
	return gin.H{
		"success_count": successCount,
		"total":         len(results),
		"results":       results,
	}
}

func BatchGenerateOrgMembers(c *gin.Context) {
	idStr := c.Param("id")
	orgId, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	userId := c.GetInt("id")
	userRoleVal, _ := c.Get("role")
	userRole, _ := userRoleVal.(int)
	if userRole < model.RoleAdminUser && !model.IsOrgAdmin(orgId, userId) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "需要企业管理员权限"})
		return
	}
	var req struct {
		Prefix         string `json:"prefix"`
		Count          int    `json:"count"`
		PasswordPrefix string `json:"password_prefix"`
		Role           string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Prefix == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "前缀不能为空"})
		return
	}
	if req.Count <= 0 || req.Count > 500 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "生成数量需在1-500之间"})
		return
	}
	role := req.Role
	if role == "" {
		role = model.OrgRoleMember
	}
	successCount := 0
	failedUsers := []string{}
	for i := 1; i <= req.Count; i++ {
		username := fmt.Sprintf("%s%d", req.Prefix, i)
		password := fmt.Sprintf("%s%s", req.PasswordPrefix, username)
		user := &model.User{
			Username:    username,
			Password:    password,
			DisplayName: username,
			Role:        model.RoleCommonUser,
			Status:      model.UserStatusEnabled,
		}
		if err := user.Insert(context.Background(), 0); err != nil {
			failedUsers = append(failedUsers, username)
			continue
		}
		// 转入企业:清零注册赠送的积分 + 写审计 + 加入 org_members
		if err := model.TransferToEnterprise(userId, user.Id, orgId, role, "批量生成企业成员"); err != nil {
			failedUsers = append(failedUsers, username+"(转入企业失败)")
			continue
		}
		successCount++
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"success_count": successCount,
			"total":         req.Count,
			"failed_users":  failedUsers,
		},
	})
}
