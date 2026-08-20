package datasync

// 时间字段风格：决定范围模式（time_range）如何生成 WHERE 子句。
const (
	TimeKindNone     = 0 // 无时间字段，只支持全量
	TimeKindUnixSec  = 1 // int64 Unix 秒（created_at / created_time）
	TimeKindDateTime = 2 // time.Time DATETIME（created_at）
)

// TableSpec 描述模块内一张表的同步元数据。
type TableSpec struct {
	Name string `json:"name"`
	// TimeField 时间字段名（用于 time_range / latest_n 排序），TimeKindNone 时为空。
	TimeField string `json:"time_field"`
	TimeKind  int    `json:"time_kind"`
	// Primary 标记是否为模块主表：范围模式只作用于主表，关联小表始终全量。
	Primary bool `json:"primary"`
}

// ModuleSpec 描述一个业务模块及其包含的表集合。
type ModuleSpec struct {
	Key    string      `json:"key"`
	Name   string      `json:"name"`
	Tables []TableSpec `json:"tables"`
}

// SupportsRange 模块是否支持范围模式（存在带时间字段的主表）。
func (m ModuleSpec) SupportsRange() bool {
	for _, t := range m.Tables {
		if t.Primary && t.TimeKind != TimeKindNone {
			return true
		}
	}
	return false
}

// modules 模块注册表。新增表只改这一处。
// 时间字段风格依据计划文档第二节：
//   - Unix 秒 int64: logs/tokens/channels/redemptions/skills/feedback/model_definitions
//   - time.Time DATETIME: users/orders/invoices/organizations/subscriptions/client_events/activities
var modules = []ModuleSpec{
	{Key: "users", Name: "用户与令牌", Tables: []TableSpec{
		{Name: "users", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "tokens", TimeField: "created_time", TimeKind: TimeKindUnixSec, Primary: true},
		{Name: "user_timed_quotas", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "account_type_changes", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
	}},
	{Key: "channels", Name: "渠道与模型", Tables: []TableSpec{
		{Name: "channels", TimeField: "created_time", TimeKind: TimeKindUnixSec, Primary: true},
		{Name: "model_definitions", TimeField: "created_time", TimeKind: TimeKindUnixSec, Primary: true},
		{Name: "abilities", TimeKind: TimeKindNone},
	}},
	{Key: "options", Name: "系统配置", Tables: []TableSpec{
		{Name: "options", TimeKind: TimeKindNone},
	}},
	{Key: "logs", Name: "调用日志", Tables: []TableSpec{
		{Name: "logs", TimeField: "created_at", TimeKind: TimeKindUnixSec, Primary: true},
	}},
	{Key: "billing", Name: "订单与支付", Tables: []TableSpec{
		{Name: "orders", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "invoices", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "redemptions", TimeField: "created_time", TimeKind: TimeKindUnixSec, Primary: true},
		{Name: "recharge_packages", TimeKind: TimeKindNone},
		{Name: "recharge_records", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "subscriptions", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
	}},
	{Key: "orgs", Name: "企业组织", Tables: []TableSpec{
		{Name: "organizations", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "org_members", TimeKind: TimeKindNone},
		{Name: "org_invitations", TimeKind: TimeKindNone},
		{Name: "org_departments", TimeKind: TimeKindNone},
		{Name: "org_member_limits", TimeKind: TimeKindNone},
		{Name: "org_audit_logs", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "org_timed_quotas", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
	}},
	{Key: "skills", Name: "技能广场", Tables: []TableSpec{
		{Name: "skills", TimeField: "created_at", TimeKind: TimeKindUnixSec, Primary: true},
		{Name: "skill_category_types", TimeKind: TimeKindNone},
		{Name: "skill_categories", TimeKind: TimeKindNone},
		{Name: "skill_category_relations", TimeKind: TimeKindNone},
		{Name: "personal_skills", TimeField: "created_at", TimeKind: TimeKindUnixSec, Primary: true},
	}},
	{Key: "events", Name: "埋点与反馈", Tables: []TableSpec{
		{Name: "client_events", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "feedbacks", TimeField: "created_at", TimeKind: TimeKindUnixSec, Primary: true},
		{Name: "admin_operation_logs", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
	}},
	{Key: "marketing", Name: "运营活动", Tables: []TableSpec{
		{Name: "activities", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "activity_participations", TimeKind: TimeKindNone},
		{Name: "user_crowds", TimeKind: TimeKindNone},
		{Name: "member_identities", TimeKind: TimeKindNone},
		{Name: "user_tags", TimeKind: TimeKindNone},
		{Name: "user_tag_relations", TimeKind: TimeKindNone},
		{Name: "user_coupons", TimeKind: TimeKindNone},
		{Name: "invite_records", TimeKind: TimeKindNone},
	}},
	{Key: "versions", Name: "版本管理", Tables: []TableSpec{
		{Name: "version_notes", TimeField: "created_at", TimeKind: TimeKindDateTime, Primary: true},
		{Name: "version_releases", TimeField: "detected_at", TimeKind: TimeKindDateTime, Primary: true},
	}},
	{Key: "dashboards", Name: "仪表盘配置", Tables: []TableSpec{
		{Name: "custom_dashboard_charts", TimeField: "created_at", TimeKind: TimeKindUnixSec, Primary: true},
		{Name: "operation_dashboards", TimeField: "created_at", TimeKind: TimeKindUnixSec, Primary: true},
	}},
}

// Modules 返回模块注册表（只读）。
func Modules() []ModuleSpec {
	return modules
}

// findModule 按 key 查模块。
func findModule(key string) (ModuleSpec, bool) {
	for _, m := range modules {
		if m.Key == key {
			return m, true
		}
	}
	return ModuleSpec{}, false
}
