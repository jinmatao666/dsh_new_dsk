package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/middleware"
	"github.com/songquanpeng/one-api/model"
)

func OrgLogin(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Username == "" || req.Password == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户名和密码不能为空"})
		return
	}
	org, err := model.GetOrgByLoginUsername(req.Username)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户名或密码错误"})
		return
	}
	if org.Status != model.OrgStatusEnabled {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该企业已被禁用"})
		return
	}
	if !common.ValidatePasswordAndHash(req.Password, org.LoginPassword) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户名或密码错误"})
		return
	}
	token, err := middleware.GenerateOrgToken(org.Id, org.Name)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "生成令牌失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"token":    token,
			"org_id":   org.Id,
			"org_name": org.Name,
		},
	})
}

func OrgDashboard(c *gin.Context) {
	orgId := c.GetInt("org_id")
	org, err := model.GetOrgById(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	memberCount, _ := model.GetOrgMemberCount(orgId)
	// 额度口径统一以 org_timed_quotas 账本为准(排除已过期批次),而非镜像列 org.Quota/UsedQuota:
	//   - valid_total = 未过期 SUM(amount)(有效发放总额)
	//   - quota(剩余)= 未过期 SUM(remaining)(可用余额)
	//   - used_quota  = valid_total - 可用(有效发放里已消耗)
	// 三者自洽,与 air 账本页、org-admin 账本页口径一致.
	validTotal, available, used, err := model.GetOrgQuotaSummary(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"org_name":       org.Name,
			"valid_total":    validTotal,
			"quota":          available,
			"used_quota":     used,
			"member_count":   memberCount,
			"max_members":    org.MaxMembers,
			"quota_per_unit": config.QuotaPerUnit,
		},
	})
}

// OrgGetQuotaLedger 企业门户:额度账本明细页数据.
// 返回全部账本行(含过期/已耗尽)+ 三口径小结.前端按 (expires_at, remaining) 派生状态.
//
// GET /org-api/quota/ledger
func OrgGetQuotaLedger(c *gin.Context) {
	orgId := c.GetInt("org_id")
	rows, err := model.GetOrgTimedQuotaAll(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	validTotal, available, used, err := model.GetOrgQuotaSummary(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": rows,
			"summary": gin.H{
				"valid_total": validTotal,
				"available":   available,
				"used":        used,
			},
			"quota_per_unit": config.QuotaPerUnit,
		},
	})
}

func OrgGetSettings(c *gin.Context) {
	orgId := c.GetInt("org_id")
	org, err := model.GetOrgById(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"name":          org.Name,
			"code":          org.Code,
			"billing_email": org.BillingEmail,
			"tax_num":       org.TaxNum,
			"max_members":   org.MaxMembers,
		},
	})
}

func OrgUpdateSettings(c *gin.Context) {
	orgId := c.GetInt("org_id")
	var req struct {
		Name         string `json:"name"`
		BillingEmail string `json:"billing_email"`
		TaxNum       string `json:"tax_num"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	org, err := model.GetOrgById(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	if req.Name != "" {
		org.Name = req.Name
	}
	org.BillingEmail = req.BillingEmail
	org.TaxNum = req.TaxNum
	err = org.Update()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func OrgGetMembers(c *gin.Context) {
	orgId := c.GetInt("org_id")
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	keyword := c.Query("keyword")
	sortBy := c.Query("sort")
	order := c.Query("order")
	members, total, err := model.GetOrgMembersWithCount(orgId, p*10, 10, keyword, sortBy, order)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": members, "total": total})
}

func OrgAddMember(c *gin.Context) {
	orgId := c.GetInt("org_id")
	var req struct {
		UserId   int    `json:"user_id"`
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Create   bool   `json:"create"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}

	count, _ := model.GetOrgMemberCount(orgId)
	org, _ := model.GetOrgById(orgId)
	if org != nil && int(count) >= org.MaxMembers {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业成员数已达上限"})
		return
	}

	targetUserId := req.UserId

	if req.Create {
		if req.Username == "" || req.Password == "" {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "创建用户需要提供用户名和密码"})
			return
		}
		newUser := &model.User{
			Username:    req.Username,
			Password:    req.Password,
			DisplayName: req.Username,
		}
		if err := newUser.Insert(c.Request.Context(), 0); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "创建用户失败: " + err.Error()})
			return
		}
		targetUserId = newUser.Id
	} else {
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
	}

	role := req.Role
	if role == "" {
		role = model.OrgRoleMember
	}
	member := &model.OrgMember{
		OrgId:  orgId,
		UserId: targetUserId,
		Role:   role,
		Status: model.OrgMemberStatusEnabled,
	}
	err := model.AddOrgMember(member)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "添加失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func OrgUpdateMember(c *gin.Context) {
	orgId := c.GetInt("org_id")
	targetUserId, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
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
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func OrgRemoveMember(c *gin.Context) {
	orgId := c.GetInt("org_id")
	targetUserId, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	err = model.RemoveOrgMember(orgId, targetUserId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func OrgBatchAddMembers(c *gin.Context) {
	orgId := c.GetInt("org_id")
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
		member := &model.OrgMember{
			OrgId:  orgId,
			UserId: uid,
			Role:   role,
			Status: model.OrgMemberStatusEnabled,
		}
		if model.AddOrgMember(member) == nil {
			successCount++
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"success_count": successCount, "total": len(req.UserIds)}})
}

// OrgBatchImportMembers 企业门户:从解析后的花名册批量导入成员(前缀+工号,部门按名匹配已有).
func OrgBatchImportMembers(c *gin.Context) {
	orgId := c.GetInt("org_id")
	// 门户 JWT 仅携带 org_id,无操作者用户身份;审计 admin_id 记 0(系统/门户).
	adminId := 0
	prefix, passwordPrefix, role, rows, ok := bindImportRequest(c)
	if !ok {
		return
	}
	results := importOrgMembersCore(adminId, orgId, prefix, passwordPrefix, role, rows)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": summarizeImport(results)})
}

// parseOrgLogFilter 从 query 解析企业用量过滤条件:
//   - dept_id:部门维度(含子部门),解析为成员 user_ids
//   - start/end:unix 秒时间范围
func parseOrgLogFilter(c *gin.Context, orgId int) (model.OrgLogFilter, error) {
	var f model.OrgLogFilter
	if v := c.Query("dept_id"); v != "" {
		deptId, err := strconv.Atoi(v)
		if err == nil && deptId > 0 {
			userIds, err := model.GetOrgDeptMemberUserIds(orgId, deptId)
			if err != nil {
				return f, err
			}
			f.HasUsers = true
			f.UserIds = userIds
		}
	}
	if v := c.Query("start"); v != "" {
		if ts, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.StartTs = ts
		}
	}
	if v := c.Query("end"); v != "" {
		if ts, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.EndTs = ts
		}
	}
	return f, nil
}

func OrgGetLogs(c *gin.Context) {
	orgId := c.GetInt("org_id")
	p, _ := strconv.Atoi(c.DefaultQuery("p", "0"))
	if p < 0 {
		p = 0
	}
	f, err := parseOrgLogFilter(c, orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	logs, err := model.GetOrgLogs(orgId, p*10, 10, f)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": logs})
}

func OrgGetLogsStat(c *gin.Context) {
	orgId := c.GetInt("org_id")
	f, err := parseOrgLogFilter(c, orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	stat, err := model.GetOrgLogsStat(orgId, f)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": stat})
}

// OrgGetUsageByMember 按成员聚合的用量汇总(总请求/总 token/总消耗),支持部门+时间筛选.
func OrgGetUsageByMember(c *gin.Context) {
	orgId := c.GetInt("org_id")
	f, err := parseOrgLogFilter(c, orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	rows, err := model.GetOrgUsageByMember(orgId, f)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// OrgGetUsageByModel 按模型聚合的用量汇总,支持部门+时间筛选.
func OrgGetUsageByModel(c *gin.Context) {
	orgId := c.GetInt("org_id")
	f, err := parseOrgLogFilter(c, orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	rows, err := model.GetOrgUsageByModel(orgId, f)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

// OrgGetUsageSeries 用量时间序列:每个时间桶的活跃用户/请求/Token,外加区间去重活跃用户数.
// 支持部门/时间筛选(parseOrgLogFilter);granularity=hour 时按小时分组(适合短区间),否则按天.
func OrgGetUsageSeries(c *gin.Context) {
	orgId := c.GetInt("org_id")
	f, err := parseOrgLogFilter(c, orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	byHour := c.Query("granularity") == "hour"
	series, err := model.GetOrgUsageSeries(orgId, f, byHour)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	activeUsers, err := model.GetOrgActiveUserCount(orgId, f)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"series":       series,
		"active_users": activeUsers,
		"granularity":  map[bool]string{true: "hour", false: "day"}[byHour],
	}})
}

// OrgGetMemberActivity 返回成员最近活跃时间映射(user_id -> unix 秒),用于识别闲置席位.
func OrgGetMemberActivity(c *gin.Context) {
	orgId := c.GetInt("org_id")
	activity, err := model.GetOrgMemberLastUsed(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": activity})
}

// OrgDashboardTrend 概览趋势:近 30 天每日消耗、本月/上月环比、预计可用天数.
func OrgDashboardTrend(c *gin.Context) {
	orgId := c.GetInt("org_id")
	if _, err := model.GetOrgById(orgId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	now := time.Now()
	start30 := now.AddDate(0, 0, -30)
	trend, err := model.GetOrgDailyTrend(orgId, start30.Unix())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// 本月 / 上月消耗(自然月)
	thisMonthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	lastMonthStart := thisMonthStart.AddDate(0, -1, 0)
	thisMonth, err := model.GetOrgQuotaInRange(orgId, thisMonthStart.Unix(), now.Unix())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	lastMonth, err := model.GetOrgQuotaInRange(orgId, lastMonthStart.Unix(), thisMonthStart.Unix())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// 环比(相对上月百分比,上月为 0 时不计算)
	var momPct float64 = 0
	if lastMonth > 0 {
		momPct = float64(thisMonth-lastMonth) / float64(lastMonth) * 100
	}

	// 近 30 天日均消耗 → 预计可用天数(剩余额度 / 日均;日均为 0 时返回 -1 表示"充足")
	// 剩余额度以账本可用余额为准(而非镜像列 org.Quota,后者是累计充值总额会偏大).
	available, err := model.GetOrgAvailableQuota(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	var total30 int64
	for _, t := range trend {
		total30 += t.Quota
	}
	avgDaily := float64(total30) / 30
	daysToExhaust := -1.0
	if avgDaily > 0 {
		daysToExhaust = float64(available) / avgDaily
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"trend":           trend,
			"this_month":      thisMonth,
			"last_month":      lastMonth,
			"mom_pct":         momPct,
			"avg_daily":       avgDaily,
			"days_to_exhaust": daysToExhaust,
			"quota_per_unit":  config.QuotaPerUnit,
		},
	})
}

// OrgServiceHealthStat 服务健康:失败率与慢请求占比(默认近 7 天,可选 ?days=).
func OrgServiceHealthStat(c *gin.Context) {
	orgId := c.GetInt("org_id")
	days := 7
	if v := c.Query("days"); v != "" {
		if d, err := strconv.Atoi(v); err == nil && d > 0 {
			days = d
		}
	}
	if days > 90 {
		days = 90
	}
	startTs := time.Now().AddDate(0, 0, -days).Unix()
	h, err := model.GetOrgServiceHealth(orgId, startTs)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	totalReq := h.ConsumeCount + h.ErrorCount
	var failureRate float64 = 0
	if totalReq > 0 {
		failureRate = float64(h.ErrorCount) / float64(totalReq)
	}
	var slowRatio float64 = 0
	if h.ConsumeCount > 0 {
		slowRatio = float64(h.SlowCount) / float64(h.ConsumeCount)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"days":          days,
			"consume_count": h.ConsumeCount,
			"error_count":   h.ErrorCount,
			"slow_count":    h.SlowCount,
			"failure_rate":  failureRate,
			"slow_ratio":    slowRatio,
		},
	})
}

func OrgGetInvitations(c *gin.Context) {
	orgId := c.GetInt("org_id")
	invitations, err := model.GetOrgInvitations(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": invitations})
}

func OrgCreateInvitation(c *gin.Context) {
	orgId := c.GetInt("org_id")
	var req struct {
		Role       string `json:"role"`
		MaxUses    int    `json:"max_uses"`
		ExpireDays int    `json:"expire_days"`
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
		InviterId: 0,
		Role:      role,
		MaxUses:   req.MaxUses,
	}
	if req.ExpireDays > 0 {
		expiredAt := time.Now().AddDate(0, 0, req.ExpireDays)
		inv.ExpiredAt = &expiredAt
	}
	err := inv.Insert()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": inv})
}

func OrgDeleteInvitation(c *gin.Context) {
	orgId := c.GetInt("org_id")
	code := c.Param("code")
	err := model.DeleteOrgInvitation(orgId, code)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
