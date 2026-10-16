package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/logger"
)

// AccountTypeChange 记录账户类型迁移审计.QuotaSnapshot 用于事后人工审查/回滚依据(产品上不暴露反向按钮).
type AccountTypeChange struct {
	Id            int64     `json:"id" gorm:"primaryKey"`
	UserId        int       `json:"user_id" gorm:"index;not null"`
	AdminId       int       `json:"admin_id" gorm:"index;not null;comment:操作平台管理员ID;0=系统迁移"`
	Direction     string    `json:"direction" gorm:"type:varchar(48);not null;comment:personal_to_enterprise / enterprise_to_personal / migration_v0"`
	FromOrgId     int       `json:"from_org_id" gorm:"default:0"`
	ToOrgId       int       `json:"to_org_id" gorm:"default:0"`
	QuotaSnapshot string    `json:"quota_snapshot" gorm:"type:text;comment:JSON快照,转入时记录被清零的资产"`
	Reason        string    `json:"reason" gorm:"type:varchar(255)"`
	CreatedAt     time.Time `json:"created_at" gorm:"autoCreateTime;index"`
}

func (AccountTypeChange) TableName() string {
	return "account_type_changes"
}

const (
	AccountTypeChangeMigrationV0     = "migration_v0"
	AccountTypeChangePersonalToEnt   = "personal_to_enterprise"
	AccountTypeChangeEnterpriseToPer = "enterprise_to_personal"
)

type accountSnapshot struct {
	Quota             int64                     `json:"quota"`
	SubscriptionQuota int64                     `json:"subscription_quota"`
	TimedQuotaTotal   int64                     `json:"timed_quota_total"`
	OrgId             int                       `json:"org_id"`
	Ledger            []accountSnapshotLedgerRow `json:"ledger,omitempty"`
	Subscriptions     []accountSnapshotSubRow    `json:"subscriptions,omitempty"`
}

type accountSnapshotLedgerRow struct {
	Id        int64      `json:"id"`
	Source    string     `json:"source"`
	Remaining int64      `json:"remaining"`
	ExpiresAt *time.Time `json:"expires_at"`
}

type accountSnapshotSubRow struct {
	Id           int       `json:"id"`
	PackageId    int       `json:"package_id"`
	PackageLevel int       `json:"package_level"`
	BillingCycle string    `json:"billing_cycle"`
	PeriodEnd    time.Time `json:"current_period_end"`
}

// IsEnterpriseAccount 是否企业账号(关联企业有效).
func (u *User) IsEnterpriseAccount() bool {
	return u != nil && u.AccountType == AccountTypeEnterprise && u.OrgId > 0
}

// IsPersonalAccount 是否个体账号.
func (u *User) IsPersonalAccount() bool {
	return u != nil && u.AccountType != AccountTypeEnterprise
}

// TransferToEnterprise 把个体账号转入指定企业:清零个人账本/订阅/聚合列,写审计.
//   - adminId=0 表示用户自助加入(邀请码场景),其它值由控制器层做管理员身份/密码校验
//   - 重复转移到同一身份会报错;若用户已经是另一家企业的成员,需先转出再转入
//   - 整个过程在单事务内完成,行锁串行
func TransferToEnterprise(adminId, userId, orgId int, role, reason string) error {
	if userId == 0 {
		return errors.New("user_id 不能为空")
	}
	if orgId == 0 {
		return errors.New("org_id 不能为空")
	}
	if role == "" {
		role = OrgRoleMember
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		// 1) 校验目标企业有效
		var org Organization
		if err := tx.Where("id = ?", orgId).First(&org).Error; err != nil {
			return fmt.Errorf("企业不存在: %w", err)
		}
		if org.Status != OrgStatusEnabled {
			return errors.New("目标企业已被禁用")
		}

		// 2) 锁住目标 user
		var user User
		query := tx.Where("id = ?", userId)
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&user).Error; err != nil {
			return fmt.Errorf("用户不存在: %w", err)
		}
		if user.Role >= RoleRootUser {
			return errors.New("root 用户不能转入企业")
		}
		if user.AccountType == AccountTypeEnterprise {
			return errors.New("用户已是企业账户,请先转出后再转入")
		}

		// 3) 快照即将被清理的资产
		snapshot, err := snapshotPersonalAssets(tx, &user)
		if err != nil {
			return err
		}

		// 4) 清零账本(保留行做历史追溯)
		if err := tx.Model(&UserTimedQuota{}).
			Where("user_id = ? AND remaining > 0", userId).
			Update("remaining", 0).Error; err != nil {
			return err
		}

		// 5) 取消 active 订阅
		if err := tx.Model(&Subscription{}).
			Where("user_id = ? AND status = ?", userId, "active").
			Update("status", "cancelled_on_transfer").Error; err != nil {
			return err
		}

		// 6) 用户聚合列归零并写身份
		updates := map[string]interface{}{
			"account_type":       AccountTypeEnterprise,
			"org_id":             orgId,
			"quota":              0,
			"subscription_quota": 0,
			"timed_quota_total":  0,
			"last_free_quota_at": nil,
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Updates(updates).Error; err != nil {
			return err
		}

		// 7) 写入或恢复 org_members 行
		if err := upsertOrgMemberTx(tx, orgId, userId, role); err != nil {
			return err
		}

		// 8) 写审计
		return writeAccountTypeChangeTx(tx, AccountTypeChange{
			UserId:        userId,
			AdminId:       adminId,
			Direction:     AccountTypeChangePersonalToEnt,
			FromOrgId:     0,
			ToOrgId:       orgId,
			QuotaSnapshot: snapshotJSON(snapshot),
			Reason:        reason,
		})
	})
	if err != nil {
		return err
	}
	// 事务提交后失效该用户的额度/group 缓存(旧个人额度已清零,group 已变企业)
	InvalidateUserAccountCache(userId)
	return nil
}

// TransferToPersonal 把企业账号转出为个体账号.个人积分**不恢复**,从 0 开始.
func TransferToPersonal(adminId, userId int, reason string) error {
	if adminId == 0 {
		return errors.New("admin_id 不能为空")
	}
	if userId == 0 {
		return errors.New("user_id 不能为空")
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		query := tx.Where("id = ?", userId)
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&user).Error; err != nil {
			return fmt.Errorf("用户不存在: %w", err)
		}
		if user.AccountType != AccountTypeEnterprise {
			return errors.New("用户当前不是企业账户")
		}
		fromOrgId := user.OrgId

		snapshot := accountSnapshot{OrgId: fromOrgId}

		if fromOrgId > 0 {
			// 不允许把企业所有者直接转为个体,会留下无主企业;先在企业内更换 owner 才能转出
			var owner OrgMember
			if err := tx.Where("org_id = ? AND user_id = ? AND role = ?", fromOrgId, userId, OrgRoleOwner).First(&owner).Error; err == nil {
				return errors.New("该用户是企业所有者,请先转移所有权后再转出")
			}
			if err := tx.Where("org_id = ? AND user_id = ?", fromOrgId, userId).
				Delete(&OrgMember{}).Error; err != nil {
				return err
			}
			// 清理该成员在原企业的日/月限额行,避免转出后残留悬挂数据
			if err := DeleteOrgMemberLimit(tx, fromOrgId, userId); err != nil {
				return err
			}
		}

		updates := map[string]interface{}{
			"account_type": AccountTypePersonal,
			"org_id":       0,
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Updates(updates).Error; err != nil {
			return err
		}

		return writeAccountTypeChangeTx(tx, AccountTypeChange{
			UserId:        userId,
			AdminId:       adminId,
			Direction:     AccountTypeChangeEnterpriseToPer,
			FromOrgId:     fromOrgId,
			ToOrgId:       0,
			QuotaSnapshot: snapshotJSON(snapshot),
			Reason:        reason,
		})
	})
	if err != nil {
		return err
	}
	// 事务提交后失效该用户的额度/group 缓存(企业额度已不再适用,DB 个人额度=0)
	InvalidateUserAccountCache(userId)
	return nil
}

// upsertOrgMemberTx 入企时若已存在历史行则恢复,否则新建.
// 恢复已存在行时:
//   - 绝不降级 owner——owner 只能通过"转移所有权"显式变更,避免迁移/重复加入把企业唯一所有者冲成普通成员;
//   - 保留原 dept_id,不无条件清零,以免抹掉成员已有的部门归属。
func upsertOrgMemberTx(tx *gorm.DB, orgId, userId int, role string) error {
	var existing OrgMember
	err := tx.Where("org_id = ? AND user_id = ?", orgId, userId).First(&existing).Error
	if err == nil {
		newRole := role
		if existing.Role == OrgRoleOwner {
			// 已是 owner,保持 owner 不被降级
			newRole = OrgRoleOwner
		}
		return tx.Model(&OrgMember{}).Where("id = ?", existing.Id).
			Updates(map[string]interface{}{
				"role":   newRole,
				"status": OrgMemberStatusEnabled,
			}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	member := OrgMember{
		OrgId:      orgId,
		UserId:     userId,
		Role:       role,
		QuotaLimit: -1,
		Status:     OrgMemberStatusEnabled,
	}
	return tx.Create(&member).Error
}

func snapshotPersonalAssets(tx *gorm.DB, user *User) (accountSnapshot, error) {
	snap := accountSnapshot{
		Quota:             user.Quota,
		SubscriptionQuota: user.SubscriptionQuota,
		TimedQuotaTotal:   user.TimedQuotaTotal,
		OrgId:             user.OrgId,
	}
	var ledger []UserTimedQuota
	if err := tx.Where("user_id = ? AND remaining > 0", user.Id).
		Order("expires_at ASC, id ASC").
		Find(&ledger).Error; err != nil {
		return snap, err
	}
	for _, row := range ledger {
		snap.Ledger = append(snap.Ledger, accountSnapshotLedgerRow{
			Id:        row.Id,
			Source:    row.Source,
			Remaining: row.Remaining,
			ExpiresAt: row.ExpiresAt,
		})
	}
	var subs []Subscription
	if err := tx.Where("user_id = ? AND status = ?", user.Id, "active").
		Find(&subs).Error; err != nil {
		return snap, err
	}
	for _, s := range subs {
		snap.Subscriptions = append(snap.Subscriptions, accountSnapshotSubRow{
			Id:           s.Id,
			PackageId:    s.PackageId,
			PackageLevel: s.PackageLevel,
			BillingCycle: s.BillingCycle,
			PeriodEnd:    s.CurrentPeriodEnd,
		})
	}
	return snap, nil
}

func snapshotJSON(snap accountSnapshot) string {
	b, err := json.Marshal(snap)
	if err != nil {
		return ""
	}
	return string(b)
}

func writeAccountTypeChangeTx(tx *gorm.DB, change AccountTypeChange) error {
	return tx.Create(&change).Error
}

// MigrateEnterpriseAccountsV0 把历史 org_members 中的 enabled 成员一次性转为企业账户身份.
//   - 幂等:若 account_type_changes 已有 migration_v0 记录则直接跳过
//   - 仅在主节点启动时调用,内部逐用户事务,失败仅记录不阻塞启动
func MigrateEnterpriseAccountsV0() error {
	var existing int64
	if err := DB.Model(&AccountTypeChange{}).
		Where("direction = ?", AccountTypeChangeMigrationV0).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}

	type pendingRow struct {
		UserId int
		OrgId  int
		Role   string
	}
	var rows []pendingRow
	// 带出每个成员在所属企业的真实 role(owner/admin/member),迁移时原样保留,
	// 不能统一按 member 迁移,否则会把企业 owner 误降级为普通成员(留下无主企业)。
	// 同一用户归属多个企业时取 org_id 最小的一条,与其 role 配对。
	err := DB.Raw(`
		SELECT m.user_id AS user_id, m.org_id AS org_id, m.role AS role
		FROM org_members m
		JOIN users u ON u.id = m.user_id
		JOIN organizations o ON o.id = m.org_id
		WHERE m.status = ? AND o.status = ? AND u.account_type = ? AND u.role < ?
		  AND m.org_id = (
		      SELECT MIN(m2.org_id) FROM org_members m2
		      JOIN organizations o2 ON o2.id = m2.org_id
		      WHERE m2.user_id = m.user_id AND m2.status = ? AND o2.status = ?
		  )
	`, OrgMemberStatusEnabled, OrgStatusEnabled, AccountTypePersonal, RoleRootUser,
		OrgMemberStatusEnabled, OrgStatusEnabled).Scan(&rows).Error
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	logger.SysLogf("account_type migration v0: 发现 %d 个历史企业成员需迁移为 enterprise 身份", len(rows))

	failed := 0
	for _, r := range rows {
		memberRole := r.Role
		if memberRole == "" {
			memberRole = OrgRoleMember
		}
		if err := TransferToEnterprise(0 /* system admin id */, r.UserId, r.OrgId, memberRole, "auto migration on enterprise isolation rollout"); err != nil {
			failed++
			logger.SysErrorf("account_type migration v0: 用户 %d -> 企业 %d 失败: %v", r.UserId, r.OrgId, err)
		}
	}
	logger.SysLogf("account_type migration v0: 完成,成功 %d,失败 %d", len(rows)-failed, failed)
	return nil
}

// AccountTypeInvariantViolation 不变量检测命中条目.
type AccountTypeInvariantViolation struct {
	UserId      int    `json:"user_id"`
	Description string `json:"description"`
}

// VerifyAccountTypeInvariants 扫描 users 表,返回所有违反隔离不变量的条目.
//   - 推荐由每日 cron 调用,发现违例只记录日志/告警,不自动修复
//   - 仅返回前若干条,避免大批量违规导致结果膨胀
func VerifyAccountTypeInvariants(limit int) ([]AccountTypeInvariantViolation, error) {
	if limit <= 0 {
		limit = 100
	}
	var hits []AccountTypeInvariantViolation
	type idRow struct {
		Id int
	}

	scan := func(sqlStr string, desc string, args ...interface{}) error {
		var ids []idRow
		if err := DB.Raw(sqlStr, args...).Scan(&ids).Error; err != nil {
			return err
		}
		for _, r := range ids {
			hits = append(hits, AccountTypeInvariantViolation{UserId: r.Id, Description: desc})
			if len(hits) >= limit {
				return nil
			}
		}
		return nil
	}

	checks := []struct {
		sql  string
		desc string
		args []interface{}
	}{
		{`SELECT id FROM users WHERE account_type = ? AND org_id = 0 LIMIT ?`,
			"enterprise account without org_id", []interface{}{AccountTypeEnterprise, limit}},
		{`SELECT id FROM users WHERE account_type = ? AND (quota > 0 OR subscription_quota > 0 OR timed_quota_total > 0) LIMIT ?`,
			"enterprise account holds personal quota", []interface{}{AccountTypeEnterprise, limit}},
		{`SELECT u.id FROM users u WHERE u.account_type = ? AND EXISTS (SELECT 1 FROM user_timed_quotas q WHERE q.user_id = u.id AND q.remaining > 0) LIMIT ?`,
			"enterprise account has live ledger row", []interface{}{AccountTypeEnterprise, limit}},
		{`SELECT id FROM users WHERE account_type = ? AND org_id <> 0 LIMIT ?`,
			"personal account has non-zero org_id", []interface{}{AccountTypePersonal, limit}},
	}

	for _, c := range checks {
		if len(hits) >= limit {
			break
		}
		if err := scan(c.sql, c.desc, c.args...); err != nil {
			return hits, err
		}
	}
	return hits, nil
}
