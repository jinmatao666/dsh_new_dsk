package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/songquanpeng/one-api/common"
)

// OrgTimedQuota 是企业积分账本.每笔发放占一行,各自有独立到期时间.
//   - expires_at IS NULL 表示永久(到期排序时强制排在最后)
//   - 扣费按 (expires_at ASC NULLS LAST, id ASC) 顺序消耗
//   - remaining 字段在扣费/退款时被原地更新;过期清理 cron 会把已过期行的 remaining 置 0
//   - organizations.quota / used_quota 在每次写入后同步维护(只读镜像列),便于报表查询
type OrgTimedQuota struct {
	Id        int64      `json:"id" gorm:"primaryKey"`
	OrgId     int        `json:"org_id" gorm:"not null;index:idx_org_alive,priority:1"`
	Amount    int64      `json:"amount" gorm:"type:bigint;not null;comment:本笔发放额"`
	Remaining int64      `json:"remaining" gorm:"type:bigint;not null;index:idx_org_alive,priority:2;comment:本笔剩余"`
	Source    string     `json:"source" gorm:"type:varchar(32);not null;comment:topup/admin/refund/migration/subscription/monthly_free"`
	SourceRef string     `json:"source_ref" gorm:"type:varchar(64);comment:订单号/操作备注"`
	ExpiresAt *time.Time `json:"expires_at" gorm:"index:idx_org_alive,priority:3;comment:NULL=永久"`
	CreatedAt time.Time  `json:"created_at" gorm:"autoCreateTime"`
}

func (OrgTimedQuota) TableName() string {
	return "org_timed_quotas"
}

const (
	OrgTimedQuotaSourceTopup        = "topup"
	OrgTimedQuotaSourceAdmin        = "admin"
	OrgTimedQuotaSourceRefund       = "refund"
	OrgTimedQuotaSourceMigration    = "migration"
	OrgTimedQuotaSourceSubscription = "subscription"
	OrgTimedQuotaSourceMonthlyFree  = "monthly_free"
)

// AddOrgTimedQuota 给企业新增一笔定时积分.事务内插账本 + 同步 organizations.quota 镜像列.
//   - amount 必须 > 0
//   - ttl == nil 表示永久;否则 expires_at = now + ttl
func AddOrgTimedQuota(orgId int, amount int64, source, sourceRef string, ttl *time.Duration) error {
	if orgId == 0 {
		return errors.New("org id 为空")
	}
	if amount <= 0 {
		return errors.New("amount 必须大于 0")
	}
	if source == "" {
		return errors.New("source 不能为空")
	}
	sourceRef = strings.TrimSpace(sourceRef)
	if len([]rune(sourceRef)) > 64 {
		sourceRef = string([]rune(sourceRef)[:64])
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		return addOrgTimedQuotaTx(tx, orgId, amount, source, sourceRef, ttl)
	})
}

func addOrgTimedQuotaTx(tx *gorm.DB, orgId int, amount int64, source, sourceRef string, ttl *time.Duration) error {
	var expiresAt *time.Time
	if ttl != nil {
		t := time.Now().Add(*ttl)
		expiresAt = &t
	}
	// 校验企业存在
	var exists int64
	if err := tx.Model(&Organization{}).Where("id = ?", orgId).Count(&exists).Error; err != nil {
		return err
	}
	if exists == 0 {
		return errors.New("企业不存在")
	}
	row := OrgTimedQuota{
		OrgId:     orgId,
		Amount:    amount,
		Remaining: amount,
		Source:    source,
		SourceRef: sourceRef,
		ExpiresAt: expiresAt,
	}
	if err := tx.Create(&row).Error; err != nil {
		return err
	}
	return tx.Model(&Organization{}).Where("id = ?", orgId).
		Update("quota", gorm.Expr("quota + ?", amount)).Error
}

// GetOrgTimedQuotaBreakdown 返回企业当前未过期的账本明细(按到期升序,永久排最后).
func GetOrgTimedQuotaBreakdown(orgId int) ([]OrgTimedQuota, error) {
	var rows []OrgTimedQuota
	err := DB.
		Where("org_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)", orgId, time.Now()).
		Order("CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC").
		Find(&rows).Error
	return rows, err
}

// GetOrgTimedQuotaAll 返回企业**全部**账本行(不过滤 remaining/expires_at),
// 按 created_at DESC, id DESC 排序(最新充值在前).供账本明细列表页展示.
func GetOrgTimedQuotaAll(orgId int) ([]OrgTimedQuota, error) {
	var rows []OrgTimedQuota
	err := DB.
		Where("org_id = ?", orgId).
		Order("created_at DESC, id DESC").
		Find(&rows).Error
	return rows, err
}

// GetOrgQuotaSummary 一次算出企业额度三口径:
//   - validTotal = 未过期账本行 SUM(amount)(有效发放总盘子,排除已过期作废批次)
//   - available  = 未过期且 remaining>0 SUM(remaining)(可用余额,同 GetOrgAvailableQuota)
//   - used       = validTotal - available(有效发放里已消耗的部分)
//
// 三者自洽:validTotal = available + used.
func GetOrgQuotaSummary(orgId int) (validTotal, available, used int64, err error) {
	now := time.Now()
	if err = DB.Model(&OrgTimedQuota{}).
		Where("org_id = ? AND (expires_at IS NULL OR expires_at > ?)", orgId, now).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&validTotal).Error; err != nil {
		return
	}
	if err = DB.Model(&OrgTimedQuota{}).
		Where("org_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)", orgId, now).
		Select("COALESCE(SUM(remaining), 0)").
		Scan(&available).Error; err != nil {
		return
	}
	used = validTotal - available
	return
}

// GetOrgAvailableQuota 返回企业可用余额 = SUM(remaining).
// 与 organizations.quota - used_quota 应保持一致;不一致代表镜像列漂移,需要 cron 校验.
func GetOrgAvailableQuota(orgId int) (int64, error) {
	var total int64
	err := DB.Model(&OrgTimedQuota{}).
		Where("org_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)", orgId, time.Now()).
		Select("COALESCE(SUM(remaining), 0)").
		Scan(&total).Error
	return total, err
}

// DecreaseOrgQuotaByLedger 按到期顺序消耗企业额度.
//   - quota > 0
//   - 余额不足返回错误;事务内行锁串行
//   - 同步维护 organizations.used_quota / quota 镜像列(used_quota += quota)
//
// 返回每笔被扣减的账本行 ID -> 实际扣减额(供退款时按原路径加回).
func DecreaseOrgQuotaByLedger(orgId int, quota int64) (map[int64]int64, error) {
	if quota < 0 {
		return nil, errors.New("quota 不能为负数")
	}
	if quota == 0 {
		return nil, nil
	}
	deducted := map[int64]int64{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var rows []OrgTimedQuota
		nowSql := "NOW()"
		if common.UsingSQLite {
			nowSql = "CURRENT_TIMESTAMP"
		}
		query := tx.
			Where("org_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > "+nowSql+")", orgId).
			Order("CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC")
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Find(&rows).Error; err != nil {
			return err
		}

		remain := quota
		var totalTaken int64
		for _, row := range rows {
			if remain == 0 {
				break
			}
			take := row.Remaining
			if take > remain {
				take = remain
			}
			res := tx.Model(&OrgTimedQuota{}).Where("id = ? AND remaining >= ?", row.Id, take).
				Update("remaining", gorm.Expr("remaining - ?", take))
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				return errors.New("企业账本并发扣减冲突")
			}
			deducted[row.Id] = take
			remain -= take
			totalTaken += take
		}
		if remain > 0 {
			return errors.New("企业额度不足")
		}
		// 同步镜像列:used_quota += totalTaken,保持与 logs/报表 SQL 兼容
		return tx.Model(&Organization{}).Where("id = ?", orgId).
			Update("used_quota", gorm.Expr("used_quota + ?", totalTaken)).Error
	})
	if err != nil {
		return nil, err
	}
	return deducted, nil
}

// greatestZeroExpr 返回 "MAX(col - ?, 0)" 兼容写法.
// 生产用 MySQL/PG 走 GREATEST,测试用 SQLite 走 MAX(...).两个函数语义一致.
func greatestZeroExpr(col string, amount int64) clause.Expr {
	if common.UsingSQLite {
		return gorm.Expr("MAX("+col+" - ?, 0)", amount)
	}
	return gorm.Expr("GREATEST("+col+" - ?, 0)", amount)
}

// GetOrderOrgRemaining 返回某笔企业订单当前在账本中的剩余额度之和。
// 仅统计 source_ref=orderNo 的未过期行。用于改单计算「本单剩余」。
func GetOrderOrgRemaining(orgId int, orderNo string) (int64, error) {
	var total int64
	err := DB.Model(&OrgTimedQuota{}).
		Where("org_id = ? AND source_ref = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)",
			orgId, orderNo, time.Now()).
		Select("COALESCE(SUM(remaining), 0)").
		Scan(&total).Error
	return total, err
}

// GetOrderOrgExpiry 返回某笔企业订单账本行的到期时间（取该单仍有剩余的最早一行）。
// 企业充值通常永久(expires_at=NULL)。返回 (nil, true, nil) 表示有活跃行且永久。
func GetOrderOrgExpiry(orgId int, orderNo string) (*time.Time, bool, error) {
	var row OrgTimedQuota
	err := DB.
		Where("org_id = ? AND source_ref = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)",
			orgId, orderNo, time.Now()).
		Order("CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC").
		First(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return row.ExpiresAt, true, nil
}

// RewriteOrderOrgQuotaTx 改单时改写某笔企业订单的账本：
// 把该单所有活跃行 remaining 清零，再插入一行新账本(remaining=newRemaining, 沿用 expiresAt)，
// 并同步 organizations 镜像列。available = quota - used_quota，本操作只动 quota：
// quota += (newRemaining - clearSum)，used_quota 不变（已用部分保留）。
func RewriteOrderOrgQuotaTx(tx *gorm.DB, orgId int, orderNo string, newRemaining int64, expiresAt *time.Time) error {
	if orgId == 0 {
		return errors.New("org id 为空")
	}
	if newRemaining < 0 {
		newRemaining = 0
	}

	var clearSum int64
	if err := tx.Model(&OrgTimedQuota{}).
		Where("org_id = ? AND source_ref = ? AND remaining > 0", orgId, orderNo).
		Select("COALESCE(SUM(remaining), 0)").Scan(&clearSum).Error; err != nil {
		return err
	}
	if clearSum > 0 {
		if err := tx.Model(&OrgTimedQuota{}).
			Where("org_id = ? AND source_ref = ? AND remaining > 0", orgId, orderNo).
			Update("remaining", 0).Error; err != nil {
			return err
		}
	}

	if newRemaining > 0 {
		row := OrgTimedQuota{
			OrgId:     orgId,
			Amount:    newRemaining,
			Remaining: newRemaining,
			Source:    OrgTimedQuotaSourceTopup,
			SourceRef: orderNo,
			ExpiresAt: expiresAt,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}

	delta := newRemaining - clearSum
	if delta == 0 {
		return nil
	}
	var org Organization
	if err := tx.Select("id", "quota").Where("id = ?", orgId).First(&org).Error; err != nil {
		return err
	}
	newQuota := org.Quota + delta
	if newQuota < 0 {
		newQuota = 0
	}
	return tx.Model(&Organization{}).Where("id = ?", orgId).
		Update("quota", newQuota).Error
}

// RefundOrgQuotaByLedger 按 DecreaseOrgQuotaByLedger 返回的 map 原路径退款.
//   - 仅在请求失败/部分超额时调用
//   - 过期行(expires_at <= now 或 remaining 已清零)会被跳过,这部分资金计入企业损失
//   - 同步把 organizations.used_quota 减回去
func RefundOrgQuotaByLedger(orgId int, deducted map[int64]int64) error {
	if len(deducted) == 0 {
		return nil
	}
	nowSql := "NOW()"
	if common.UsingSQLite {
		nowSql = "CURRENT_TIMESTAMP"
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var totalRefund int64
		for rowId, amount := range deducted {
			if amount <= 0 {
				continue
			}
			// 三个守卫:
			//   1) remaining + amount <= 该行 amount: 防止退超过本笔总额
			//   2) expires_at NULL OR expires_at > now: 拒绝复活已过期行
			//   3) WHERE 命中行数为 0 时直接跳过(被并发或过期 cron 处理过)
			res := tx.Model(&OrgTimedQuota{}).
				Where("id = ? AND remaining + ? <= amount AND (expires_at IS NULL OR expires_at > "+nowSql+")", rowId, amount).
				Update("remaining", gorm.Expr("remaining + ?", amount))
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				continue
			}
			totalRefund += amount
		}
		if totalRefund > 0 {
			return tx.Model(&Organization{}).Where("id = ?", orgId).
				Update("used_quota", greatestZeroExpr("used_quota", totalRefund)).Error
		}
		return nil
	})
}

// ExpireOrgTimedQuotas 把已过期账本笔的 remaining 置 0,并同步 organizations.quota 镜像列.
//   - 由每天 0 点 cron 调用
//   - 幂等:对已 remaining=0 或 expires_at IS NULL 的行不会处理
func ExpireOrgTimedQuotas() error {
	now := time.Now()
	return DB.Transaction(func(tx *gorm.DB) error {
		type agg struct {
			OrgId int
			Sum   int64
		}
		var aggs []agg
		err := tx.Model(&OrgTimedQuota{}).
			Select("org_id, SUM(remaining) AS sum").
			Where("remaining > 0 AND expires_at IS NOT NULL AND expires_at <= ?", now).
			Group("org_id").
			Scan(&aggs).Error
		if err != nil {
			return err
		}
		if len(aggs) == 0 {
			return nil
		}
		for _, a := range aggs {
			if a.Sum <= 0 {
				continue
			}
			// quota 是"可用 + 已用"的累计概念:过期时仅扣 quota,不动 used_quota.
			// 这与个人版 ExpireTimedQuotas 的语义一致.
			if err := tx.Model(&Organization{}).Where("id = ?", a.OrgId).
				Update("quota", greatestZeroExpr("quota", a.Sum)).Error; err != nil {
				return err
			}
		}
		return tx.Model(&OrgTimedQuota{}).
			Where("remaining > 0 AND expires_at IS NOT NULL AND expires_at <= ?", now).
			Update("remaining", 0).Error
	})
}

// MigrateOrgQuotaToLedgerV0 把 organizations.quota - used_quota 一次性迁入永久 ledger 行.
//   - 幂等:仅处理未在账本中出现过的企业(NOT EXISTS migration 行)
//   - 入账时不动 organizations.quota 列,保持镜像不变
func MigrateOrgQuotaToLedgerV0() error {
	type pendingOrg struct {
		Id        int
		Available int64
	}
	var rows []pendingOrg
	err := DB.Raw(`
		SELECT o.id, (o.quota - o.used_quota) AS available
		FROM organizations o
		WHERE (o.quota - o.used_quota) > 0
		  AND NOT EXISTS (
		    SELECT 1 FROM org_timed_quotas q
		    WHERE q.org_id = o.id AND q.source = ?
		  )
	`, OrgTimedQuotaSourceMigration).Scan(&rows).Error
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	for _, r := range rows {
		err := DB.Transaction(func(tx *gorm.DB) error {
			row := OrgTimedQuota{
				OrgId:     r.Id,
				Amount:    r.Available,
				Remaining: r.Available,
				Source:    OrgTimedQuotaSourceMigration,
				SourceRef: "v1_initial",
			}
			return tx.Create(&row).Error
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// OrgQuotaDrift 描述一个企业的镜像列与真相(账本/成员聚合)之间的漂移.
//   - AvailFixed:本次对账是否把 organizations.quota/used_quota 重算回账本口径
//   - MemberMismatch:成员 used_quota 之和 != 账本口径已用(仅告警,不自愈)
type OrgQuotaDrift struct {
	OrgId       int
	OrgName     string
	LedgerAvail int64 // 账本未过期 SUM(remaining)(可用)
	MirrorAvail int64 // quota - used_quota(修正前的镜像可用)

	LedgerValidTotal int64 // 账本未过期 SUM(amount)(有效总额,应等于镜像 quota)
	LedgerUsed       int64 // 账本口径已用 = valid_total - available(应等于镜像 used_quota)
	MirrorQuota      int64 // organizations.quota(修正前)
	MirrorUsed       int64 // organizations.used_quota(修正前)
	AvailFixed       bool  // 是否修正了镜像 quota/used_quota

	MemberUsedSum  int64 // 成员 used_quota 之和
	MemberMismatch bool
}

// ReconcileOrgQuotaMirrors 对账企业额度镜像列,以 org_timed_quotas 账本为唯一真相.
//
// 账本是唯一真相,organizations.quota/used_quota、org_members.used_quota 都是镜像列,
// 由跨事务、失败不互相回滚的多步写入维护(见 relay/controller/org_billing.go),会漂移.
// 本函数在每日 cron(过期清理之后)运行,做两件事:
//
//  1. 镜像列自愈:以账本为准,把镜像列两个字段都重算回账本口径,使所有读者
//     (即便有历史直接读镜像列的报表)看到的口径与展示页/账本页一致:
//       - quota      = 账本有效总额 valid_total(未过期 SUM(amount))
//       - used_quota = 账本口径已用   = valid_total - 账本可用(未过期 SUM(remaining))
//     修正后 quota - used_quota == 账本可用,三口径自洽.
//     (旧实现只修 quota、保留 used_quota 历史累计,会让"已用"含已过期批次消耗而与账本口径漂移;
//      现统一到账本口径,不再保留镜像 used_quota 的独立语义.)
//  2. 成员用量审计:成员 used_quota 之和应等于账本口径已用.
//     不一致说明消费链路某步失败,只上报不自愈(需人工核查落哪一步).
//
// 返回所有存在漂移的企业报告(供 cron 打日志/告警).只读+自愈修正,不抛错单个企业失败不影响其他.
func ReconcileOrgQuotaMirrors() ([]OrgQuotaDrift, error) {
	var orgs []*Organization
	if err := DB.Select("id, name, quota, used_quota").Find(&orgs).Error; err != nil {
		return nil, err
	}
	now := time.Now()
	var drifts []OrgQuotaDrift
	for _, org := range orgs {
		// 1) 账本口径:未过期 SUM(amount)=有效总额,SUM(remaining>0)=可用,已用=两者之差.
		//    用一次扫描同时算出 valid_total 与 available.
		var agg struct {
			ValidTotal int64
			Available  int64
		}
		if err := DB.Model(&OrgTimedQuota{}).
			Where("org_id = ? AND (expires_at IS NULL OR expires_at > ?)", org.Id, now).
			Select("COALESCE(SUM(amount), 0) AS valid_total, " +
				"COALESCE(SUM(CASE WHEN remaining > 0 THEN remaining ELSE 0 END), 0) AS available").
			Scan(&agg).Error; err != nil {
			return drifts, err
		}
		ledgerAvail := agg.Available
		ledgerValidTotal := agg.ValidTotal
		ledgerUsed := ledgerValidTotal - ledgerAvail
		mirrorAvail := org.Quota - org.UsedQuota

		// 2) 成员 used_quota 之和
		var memberUsedSum int64
		if err := DB.Model(&OrgMember{}).
			Where("org_id = ?", org.Id).
			Select("COALESCE(SUM(used_quota), 0)").Scan(&memberUsedSum).Error; err != nil {
			return drifts, err
		}

		drift := OrgQuotaDrift{
			OrgId:            org.Id,
			OrgName:          org.Name,
			LedgerAvail:      ledgerAvail,
			MirrorAvail:      mirrorAvail,
			LedgerValidTotal: ledgerValidTotal,
			LedgerUsed:       ledgerUsed,
			MirrorQuota:      org.Quota,
			MirrorUsed:       org.UsedQuota,
			MemberUsedSum:    memberUsedSum,
		}

		// 镜像列漂移 → 以账本为准重算 quota 与 used_quota
		if org.Quota != ledgerValidTotal || org.UsedQuota != ledgerUsed {
			if err := DB.Model(&Organization{}).Where("id = ?", org.Id).
				Updates(map[string]interface{}{
					"quota":      ledgerValidTotal,
					"used_quota": ledgerUsed,
				}).Error; err != nil {
				return drifts, err
			}
			drift.AvailFixed = true
		}

		// 成员用量之和 != 账本口径已用 → 仅告警(账本是真相,拿它比对而非可能已漂的镜像 used_quota)
		if memberUsedSum != ledgerUsed {
			drift.MemberMismatch = true
		}

		if drift.AvailFixed || drift.MemberMismatch {
			drifts = append(drifts, drift)
		}
	}
	return drifts, nil
}
