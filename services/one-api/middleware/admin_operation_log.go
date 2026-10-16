package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// maxAuditBodySize 仅缓存不超过此大小的 JSON 请求体，防止大请求占用内存
const maxAuditBodySize = 1 << 20 // 1MB

// maxDetailLength 落库的 detail 摘要最大长度
const maxDetailLength = 2000

// auditAction 描述一个被审计端点的可读动作名与所属模块
type auditAction struct {
	Action string
	Module string
}

// actionRegistry 把管理员写端点映射成可读的中文动作名与模块。
// key 格式为 "METHOD FULLPATH"，FULLPATH 是 gin 的路由模板（含 :id 等占位符，
// 取自 c.FullPath()），不是实际请求路径。
//
// 维护约定：在 router/api.go 新增/调整受 AdminAuth 或 RootAuth 保护的
// POST/PUT/DELETE 路由时，请在此处同步登记一条对应映射。
// 未登记的写端点不会丢失记录——中间件会以 {Action: "METHOD 路径", Module: "其他"}
// 兜底落库，但动作名不够友好，因此建议补全。
// Module 统一对齐前端侧边栏的功能入口名，便于运营按页面归类查看。
var actionRegistry = map[string]auditAction{
	// 用户管理
	"POST /api/user/":                         {"创建用户", "用户管理"},
	"PUT /api/user/":                          {"更新用户", "用户管理"},
	"DELETE /api/user/:id":                    {"删除用户", "用户管理"},
	"POST /api/user/manage":                   {"用户状态管理", "用户管理"},
	"POST /api/user/timed_quota/batch":        {"批量定时积分", "用户管理"},
	"POST /api/topup":                         {"管理员充值", "用户管理"},
	"POST /api/user/:id/transfer-to-org":      {"用户转入企业", "用户管理"},
	"POST /api/user/:id/transfer-to-personal": {"用户转为个人", "用户管理"},
	// 渠道
	"POST /api/channel/":           {"新增渠道", "渠道"},
	"PUT /api/channel/":            {"更新渠道", "渠道"},
	"DELETE /api/channel/:id":      {"删除渠道", "渠道"},
	"DELETE /api/channel/disabled": {"清理禁用渠道", "渠道"},
	// 模型配置 / 系统设置
	"PUT /api/option/": {"修改系统设置", "模型配置"},
	// 商品管理（充值套餐）
	"POST /api/recharge-package/":      {"新增商品", "商品管理"},
	"PUT /api/recharge-package/":       {"更新商品", "商品管理"},
	"DELETE /api/recharge-package/:id": {"删除商品", "商品管理"},
	// 订单管理
	"POST /api/payment/admin/orders/refund": {"订单退积分", "订单管理"},
	// 日志详情
	"DELETE /api/log/": {"清理历史日志", "日志详情"},
	// 兑换码
	"POST /api/redemption/":      {"新增兑换码", "兑换码"},
	"PUT /api/redemption/":       {"更新兑换码", "兑换码"},
	"DELETE /api/redemption/:id": {"删除兑换码", "兑换码"},
	// 令牌管理
	"POST /api/admin/token/user/:user_id":       {"新增用户令牌", "令牌管理"},
	"PUT /api/admin/token/user/:user_id":        {"更新用户令牌", "令牌管理"},
	"DELETE /api/admin/token/user/:user_id/:id": {"删除用户令牌", "令牌管理"},
	// Skill 管理
	"POST /api/skill/":              {"创建技能", "Skill 管理"},
	"PUT /api/skill/:id":            {"更新技能", "Skill 管理"},
	"DELETE /api/skill/:id":         {"删除技能", "Skill 管理"},
	"POST /api/skill/:id/restore":   {"恢复技能", "Skill 管理"},
	"POST /api/skill/refresh-cache": {"刷新技能缓存", "Skill 管理"},
	"POST /api/skill/admin/batch":   {"批量技能操作", "Skill 管理"},
	// 个人技能（管理员跨用户）
	"PUT /api/personal-skill/admin/:id":    {"更新个人技能", "Skill 管理"},
	"DELETE /api/personal-skill/admin/:id": {"删除个人技能", "Skill 管理"},
	// 活动管理
	"POST /api/activity/":      {"新增活动", "活动管理"},
	"PUT /api/activity/":       {"更新活动", "活动管理"},
	"DELETE /api/activity/:id": {"删除活动", "活动管理"},
	// 用户运营（用户人群）
	"POST /api/user-crowd/":              {"新增用户人群", "用户运营"},
	"PUT /api/user-crowd/":               {"更新用户人群", "用户运营"},
	"DELETE /api/user-crowd/:id":         {"删除用户人群", "用户运营"},
	"POST /api/user-crowd/:id/calculate": {"计算人群人数", "用户运营"},
	"POST /api/user-crowd/preview":       {"预览人群", "用户运营"},
	// 企业管理
	"POST /api/organization/create":                    {"创建企业", "企业管理"},
	"PUT /api/organization/:id":                        {"更新企业", "企业管理"},
	"POST /api/organization/:id/topup":                 {"企业充值", "企业管理"},
	"POST /api/organization/:id/delete":                {"删除企业", "企业管理"},
	"POST /api/organization/:id/members":               {"新增企业成员", "企业管理"},
	"POST /api/organization/:id/members/batch":         {"批量新增企业成员", "企业管理"},
	"POST /api/organization/:id/members/generate":      {"批量生成企业成员", "企业管理"},
	"POST /api/organization/:id/members/import":        {"批量导入企业成员", "企业管理"},
	"PUT /api/organization/:id/members/:userId":        {"更新企业成员", "企业管理"},
	"DELETE /api/organization/:id/members/:userId":     {"移除企业成员", "企业管理"},
	"POST /api/organization/:id/invitation":            {"创建企业邀请码", "企业管理"},
	"DELETE /api/organization/:id/invitation/:code":    {"删除企业邀请码", "企业管理"},
	"POST /api/organization/:id/departments":           {"新增企业部门", "企业管理"},
	"PUT /api/organization/:id/departments/:deptId":    {"更新企业部门", "企业管理"},
	"DELETE /api/organization/:id/departments/:deptId": {"删除企业部门", "企业管理"},
	"PUT /api/organization/:id/members/:userId/dept":   {"设置成员部门", "企业管理"},
	"PUT /api/organization/:id/members/:userId/limit":  {"设置成员额度", "企业管理"},
}

// 命中后被脱敏的字段关键字（小写包含匹配）
var sensitiveKeys = []string{"password", "passwd", "secret", "token", "key", "private"}

// AdminOperationLog 审计中间件：记录管理员对后台数据的写操作（POST/PUT/DELETE）。
// 挂在 /api 最外层，handler（含 AdminAuth）执行后再判断是否记录，
// 因此能拿到 AdminAuth 写入 context 的 role/id/username。
func AdminOperationLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		method := c.Request.Method
		isWrite := method == "POST" || method == "PUT" || method == "DELETE"

		var bodyBytes []byte
		if isWrite && c.Request.Body != nil {
			contentType := c.GetHeader("Content-Type")
			if strings.Contains(contentType, "application/json") && c.Request.ContentLength <= maxAuditBodySize {
				if raw, err := io.ReadAll(io.LimitReader(c.Request.Body, maxAuditBodySize)); err == nil {
					bodyBytes = raw
					// 还原 body，保证后续 handler 正常解析
					c.Request.Body = io.NopCloser(bytes.NewBuffer(raw))
				}
			}
		}

		c.Next()

		if !isWrite {
			return
		}
		// AdminAuth 通过后才会在 context 写入 role；权限不足或未登录的请求 role 为 0，跳过
		role := c.GetInt(ctxkey.Role)
		if role < model.RoleAdminUser {
			return
		}
		// 失败请求（4xx/5xx）不记录为有效操作
		if c.Writer.Status() >= 400 {
			return
		}

		fullPath := c.FullPath()
		key := method + " " + fullPath
		meta, ok := actionRegistry[key]
		if !ok {
			// 未登记的写端点：回退记录，保证覆盖不漏
			meta = auditAction{Action: method + " " + fullPath, Module: "其他"}
		}

		entry := &model.AdminOperationLog{
			AdminId:       c.GetInt(ctxkey.Id),
			AdminUsername: c.GetString(ctxkey.Username),
			AdminRole:     role,
			Action:        meta.Action,
			Module:        meta.Module,
			Method:        method,
			Path:          c.Request.URL.Path,
			TargetId:      c.Param("id"),
			StatusCode:    c.Writer.Status(),
			Detail:        desensitize(bodyBytes),
			Ip:            c.ClientIP(),
		}

		go func() {
			if err := model.CreateAdminOperationLog(entry); err != nil {
				logger.SysError("failed to record admin operation log: " + err.Error())
			}
		}()
	}
}

// desensitize 解析 JSON 请求体，对敏感字段打码后返回截断摘要；非 JSON 直接截断返回。
func desensitize(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var parsed interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return truncate(string(body))
	}
	redactValue(parsed)
	out, err := json.Marshal(parsed)
	if err != nil {
		return truncate(string(body))
	}
	return truncate(string(out))
}

// redactValue 递归遍历 JSON 结构，命中敏感 key 的值替换为 ***
func redactValue(v interface{}) {
	switch val := v.(type) {
	case map[string]interface{}:
		for k, child := range val {
			if isSensitiveKey(k) {
				val[k] = "***"
				continue
			}
			redactValue(child)
		}
	case []interface{}:
		for _, child := range val {
			redactValue(child)
		}
	}
}

func isSensitiveKey(k string) bool {
	lower := strings.ToLower(k)
	for _, s := range sensitiveKeys {
		if strings.Contains(lower, s) {
			return true
		}
	}
	return false
}

func truncate(s string) string {
	if len(s) > maxDetailLength {
		return s[:maxDetailLength] + "...(truncated)"
	}
	return s
}
