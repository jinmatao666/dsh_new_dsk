package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/random"
	"github.com/songquanpeng/one-api/model"
)

func CreateOrganization(c *gin.Context) {
	var req struct {
		Name          string `json:"name"`
		Code          string `json:"code"`
		LoginUsername string `json:"login_username"`
		LoginPassword string `json:"login_password"`
		MaxMembers    int    `json:"max_members"`
		Group         string `json:"group"`
		BillingEmail  string `json:"billing_email"`
		TaxNum        string `json:"tax_num"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Name == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业名称不能为空"})
		return
	}
	if req.LoginUsername == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业登录用户名不能为空"})
		return
	}
	if req.LoginPassword == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业登录密码不能为空"})
		return
	}
	hashedPassword, err := common.Password2Hash(req.LoginPassword)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "密码加密失败"})
		return
	}
	userId := c.GetInt("id")
	org := model.Organization{
		Name:          req.Name,
		OwnerId:       userId,
		LoginUsername: req.LoginUsername,
		LoginPassword: hashedPassword,
		BillingEmail:  req.BillingEmail,
		TaxNum:        req.TaxNum,
		Discount:      100,
	}
	if req.Code == "" {
		org.Code = random.GetRandomString(8)
	} else {
		org.Code = req.Code
	}
	if req.MaxMembers == 0 {
		org.MaxMembers = 50
	} else {
		org.MaxMembers = req.MaxMembers
	}
	if req.Group == "" {
		org.Group = "default"
	} else {
		org.Group = req.Group
	}
	err = org.Insert()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": org})
}

func DeleteOrganization(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	_ = c.ShouldBindJSON(&req)
	if req.Password == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请输入管理员密码"})
		return
	}
	adminId := c.GetInt("id")
	admin, err := model.GetUserById(adminId, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "管理员信息获取失败"})
		return
	}
	if !validateAdminPassword(adminId, req.Password, admin) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "管理员密码错误"})
		return
	}
	org, err := model.GetOrgById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	err = org.Delete()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func GetAllOrganizations(c *gin.Context) {
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	orgs, err := model.GetAllOrganizations(p*10, 10)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	// 附带账本口径额度(valid_total/available/used),与成员设置/org-admin 概览同源.
	withQuota, err := model.AttachOrgQuotaSummary(orgs)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": withQuota})
}

func TopUpOrganization(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	var req struct {
		Quota         int64  `json:"quota"`
		ExpiresInDays int    `json:"expires_in_days"`
		Source        string `json:"source"`
		SourceRef     string `json:"source_ref"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Quota <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误，quota 必须大于 0"})
		return
	}
	if req.ExpiresInDays < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "expires_in_days 不能为负数"})
		return
	}
	source := req.Source
	if source == "" {
		source = model.OrgTimedQuotaSourceTopup
	}
	var ttl *time.Duration
	if req.ExpiresInDays > 0 {
		d := time.Duration(req.ExpiresInDays) * 24 * time.Hour
		ttl = &d
	}
	if err := model.AddOrgTimedQuota(id, req.Quota, source, req.SourceRef, ttl); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	// 写一条带 org_id 的充值日志,使企业维度充值流水在 logs 表可查(与个人充值 RecordTopupLog 对齐).
	// 后台管理员充值无固定操作者用户,user_id 记 0.
	logContent := fmt.Sprintf("企业后台充值 %s", common.LogQuota(req.Quota))
	if req.ExpiresInDays > 0 {
		logContent += fmt.Sprintf("，有效期 %d 天", req.ExpiresInDays)
	}
	if req.SourceRef != "" {
		logContent += "，备注：" + req.SourceRef
	}
	model.RecordOrgTopupLog(c.Request.Context(), id, 0, logContent, int(req.Quota))
	auditOrg(c, id, model.OrgAuditActionQuotaTopup, model.OrgAuditTargetQuota, 0, gin.H{
		"quota": req.Quota, "expires_in_days": req.ExpiresInDays, "source": source, "source_ref": req.SourceRef,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func SearchOrganizations(c *gin.Context) {
	keyword := c.Query("keyword")
	if keyword == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "关键词不能为空"})
		return
	}
	orgs, err := model.SearchOrganizations(keyword)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	withQuota, err := model.AttachOrgQuotaSummary(orgs)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": withQuota})
}

func UpdateOrganization(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	var req struct {
		Name             string `json:"name"`
		Group            string `json:"group"`
		MaxMembers       int    `json:"max_members"`
		BillingEmail     string `json:"billing_email"`
		TaxNum           string `json:"tax_num"`
		Discount         int    `json:"discount"`
		Password         string `json:"password"`
		LoginUsername    string `json:"login_username"`
		NewLoginPassword string `json:"new_login_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Password == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请输入管理员密码"})
		return
	}
	adminId := c.GetInt("id")
	admin, err := model.GetUserById(adminId, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "管理员信息获取失败"})
		return
	}
	if !validateAdminPassword(adminId, req.Password, admin) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "管理员密码错误"})
		return
	}
	org, err := model.GetOrgById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	// 登录用户名:非空且变更时校验唯一(login_username 有唯一索引)
	if req.LoginUsername != "" && req.LoginUsername != org.LoginUsername {
		if existing, e := model.GetOrgByLoginUsername(req.LoginUsername); e == nil && existing != nil && existing.Id != org.Id {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "该登录用户名已被占用"})
			return
		}
		org.LoginUsername = req.LoginUsername
	}
	org.Name = req.Name
	org.Group = req.Group
	org.MaxMembers = req.MaxMembers
	org.BillingEmail = req.BillingEmail
	org.TaxNum = req.TaxNum
	// 折扣率限定 1–100,0/越界回落 100(原价),避免误设为 0 导致免费
	if req.Discount < 1 || req.Discount > 100 {
		org.Discount = 100
	} else {
		org.Discount = req.Discount
	}
	if err := org.Update(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	// 可选重置登录密码:非空时 bcrypt 哈希后单独写入(明文绝不入库)
	if req.NewLoginPassword != "" {
		hashed, e := common.Password2Hash(req.NewLoginPassword)
		if e != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "密码加密失败"})
			return
		}
		if e := model.UpdateOrgPassword(org.Id, hashed); e != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": e.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func GetOrganization(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	org, err := model.GetOrgById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": org})
}

// GetOrganizationQuotaBreakdown 返回企业**全部**账本明细(含过期/已耗尽,按创建时间倒序)
// 及三口径小结 summary(有效总额/可用/已用).供 air 账本页展示.
//
// GET /api/organization/:id/quota/breakdown
func GetOrganizationQuotaBreakdown(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的企业ID"})
		return
	}
	rows, err := model.GetOrgTimedQuotaAll(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	validTotal, available, used, err := model.GetOrgQuotaSummary(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"available": available, // 兼容旧字段
			"items":     rows,
			"summary": gin.H{
				"valid_total": validTotal,
				"available":   available,
				"used":        used,
			},
		},
	})
}

// ReconcileOrganizationQuota 手动触发企业额度对账(以 org_timed_quotas 账本为真相,
// 把镜像列 quota/used_quota 重算回账本口径),返回漂移报告.供管理员随时压平镜像列,
// 而不必等每日 0 点 cron.可选 body {"org_id": N} 仅查看该企业的报告(对账仍全量执行,
// 但只返回目标企业的漂移条目).
//
// POST /api/organization/reconcile
func ReconcileOrganizationQuota(c *gin.Context) {
	var req struct {
		OrgId int `json:"org_id"`
	}
	_ = c.ShouldBindJSON(&req) // body 可选,解析失败按全量处理

	drifts, err := model.ReconcileOrgQuotaMirrors()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if req.OrgId > 0 {
		filtered := drifts[:0:0]
		for _, d := range drifts {
			if d.OrgId == req.OrgId {
				filtered = append(filtered, d)
			}
		}
		drifts = filtered
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"drift_count": len(drifts),
			"drifts":      drifts,
		},
	})
}

// validateAdminPassword 用账号中心 credential 校验管理员密码，账号中心未启用 / 该用户
// 未投影 / credential 缺失时回退 users.password 兜底。这是 S6 单源化阶段 2 的过渡形态：
// 单一收口，便于届时停写 users.password 后只需删兜底分支。
func validateAdminPassword(adminId int, plain string, admin *model.User) bool {
	ok, err := model.ValidateAccountPasswordByLocalUserID(adminId, plain)
	if err == nil {
		return ok // 账号中心命中（无论密码对错）以它为准
	}
	// ErrFallbackToLegacyPassword 等非命中错误：回退老路（users.password）
	return common.ValidatePasswordAndHash(plain, admin.Password)
}
