package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/songquanpeng/one-api/common"

	"gorm.io/gorm"
)

// UserTimedQuota 是用户积分账本.每笔发放占一行,各自有独立的到期时间.
//   - expires_at IS NULL 表示永久(到期排序时强制排在最后)
//   - 扣费按 (expires_at ASC NULLS LAST, id ASC) 顺序消耗
//   - remaining 字段在扣费/退款时被原地更新;过期清理 cron 会把已过期行的 remaining 置 0
type UserTimedQuota struct {
	Id        int64      `json:"id" gorm:"primaryKey"`
	UserId    int        `json:"user_id" gorm:"not null;index:idx_user_alive,priority:1"`
	Amount    int64      `json:"amount" gorm:"type:bigint;not null;comment:本笔发放额"`
	Remaining int64      `json:"remaining" gorm:"type:bigint;not null;index:idx_user_alive,priority:2;comment:本笔剩余"`
	Source    string     `json:"source" gorm:"type:varchar(32);not null;comment:register/redeem/topup/invite/admin/refund/migration/subscription/monthly_free"`
	SourceRef string     `json:"source_ref" gorm:"type:varchar(64);comment:订单号/兑换码 ID 等"`
	ExpiresAt *time.Time `json:"expires_at" gorm:"index:idx_user_alive,priority:3;comment:NULL=永久"`
	CreatedAt time.Time  `json:"created_at" gorm:"autoCreateTime"`
}

func (UserTimedQuota) TableName() string {
	return "user_timed_quotas"
}

// 积分发放来源标识(controllers / models 复用,避免散落字面量).
const (
	TimedQuotaSourceRegister     = "register"
	TimedQuotaSourceRedeem       = "redeem"
	TimedQuotaSourceTopup        = "topup"
	TimedQuotaSourceInvite       = "invite"
	TimedQuotaSourceAdmin        = "admin"
	TimedQuotaSourcePurchase     = "purchase"
	TimedQuotaSourceRefund       = "refund"
	TimedQuotaSourceMigration    = "migration"
	TimedQuotaSourceSubscription = "subscription"
	TimedQuotaSourceMonthlyFree  = "monthly_free"
	TimedQuotaSourceActivity     = "activity"
)

func subscriptionQuotaSources() []string {
	return []string{TimedQuotaSourceSubscription, TimedQuotaSourceMonthlyFree}
}

func isSubscriptionQuotaSource(source string) bool {
	switch source {
	case TimedQuotaSourceSubscription, TimedQuotaSourceMonthlyFree:
		return true
	default:
		return false
	}
}

// AddUserTimedQuota 给用户新增一笔定时积分.事务内插账本 + 同步 users.timed_quota_total.
//   - amount 必须 > 0
//   - ttl == nil 表示永久
//   - 调用方需准备好 source/sourceRef,二者用于运营追溯
func AddUserTimedQuota(userId int, amount int64, source, sourceRef string, ttl *time.Duration) error {
	if userId == 0 {
		return errors.New("user id 为空")
	}
	if amount <= 0 {
		return errors.New("amount 必须大于 0")
	}
	if source == "" {
		return errors.New("source 不能为空")
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		return addUserTimedQuotaTx(tx, userId, amount, source, sourceRef, ttl)
	})
}

// AddUserTimedQuotaTx 在调用方已有事务中发放定时积分。
func AddUserTimedQuotaTx(tx *gorm.DB, userId int, amount int64, source, sourceRef string, ttl *time.Duration) error {
	if userId == 0 {
		return errors.New("user id 为空")
	}
	if amount <= 0 {
		return errors.New("amount 必须大于 0")
	}
	if source == "" {
		return errors.New("source 不能为空")
	}
	return addUserTimedQuotaTx(tx, userId, amount, source, sourceRef, ttl)
}

type UserTimedQuotaBatchFilter struct {
	Keyword string
	Groups  []string
	Status  int
	Role    int
}

type UserTimedQuotaBatchResult struct {
	Matched int   `json:"matched"`
	UserIds []int `json:"user_ids,omitempty"`
}

type UserTimedQuotaBatchPreviewUser struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Group       string `json:"group"`
	Status      int    `json:"status"`
	Role        int    `json:"role"`
	Quota       int64  `json:"quota"`
}

type UserTimedQuotaBatchPreviewResult struct {
	Matched int64                            `json:"matched"`
	Users   []UserTimedQuotaBatchPreviewUser `json:"users"`
}

func BatchAddUserTimedQuota(filter UserTimedQuotaBatchFilter, amount int64, sourceRef string, ttl *time.Duration) (*UserTimedQuotaBatchResult, error) {
	if amount <= 0 {
		return nil, errors.New("amount 必须大于 0")
	}
	sourceRef = strings.TrimSpace(sourceRef)
	if len([]rune(sourceRef)) > 64 {
		sourceRef = string([]rune(sourceRef)[:64])
	}

	result := &UserTimedQuotaBatchResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		userQuery := applyUserTimedQuotaBatchFilter(tx.Model(&User{}), filter).
			Select("id").
			Order("id asc")

		var userIds []int
		if err := userQuery.Pluck("id", &userIds).Error; err != nil {
			return err
		}
		result.Matched = len(userIds)
		result.UserIds = userIds
		if len(userIds) == 0 {
			return nil
		}

		var expiresAt *time.Time
		if ttl != nil {
			t := time.Now().Add(*ttl)
			expiresAt = &t
		}
		rows := make([]UserTimedQuota, 0, len(userIds))
		for _, userId := range userIds {
			rows = append(rows, UserTimedQuota{
				UserId:    userId,
				Amount:    amount,
				Remaining: amount,
				Source:    TimedQuotaSourceAdmin,
				SourceRef: sourceRef,
				ExpiresAt: expiresAt,
			})
		}
		if err := tx.CreateInBatches(rows, 500).Error; err != nil {
			return err
		}
		return tx.Model(&User{}).
			Where("id IN ?", userIds).
			Updates(map[string]interface{}{
				"timed_quota_total": gorm.Expr("timed_quota_total + ?", amount),
				"quota":             gorm.Expr("quota + ?", amount),
			}).Error
	})
	return result, err
}

func CountUsersForTimedQuotaBatch(filter UserTimedQuotaBatchFilter) (int64, error) {
	var count int64
	err := applyUserTimedQuotaBatchFilter(DB.Model(&User{}), filter).Count(&count).Error
	return count, err
}

func PreviewUsersForTimedQuotaBatch(filter UserTimedQuotaBatchFilter, limit int) (*UserTimedQuotaBatchPreviewResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	result := &UserTimedQuotaBatchPreviewResult{}
	query := applyUserTimedQuotaBatchFilter(DB.Model(&User{}), filter)
	if err := query.Count(&result.Matched).Error; err != nil {
		return nil, err
	}
	err := applyUserTimedQuotaBatchFilter(DB.Model(&User{}), filter).
		Select("id", "username", "display_name", "email", "group", "status", "role", "quota").
		Order("id asc").
		Limit(limit).
		Scan(&result.Users).Error
	if err != nil {
		return nil, err
	}
	return result, nil
}

func applyUserTimedQuotaBatchFilter(query *gorm.DB, filter UserTimedQuotaBatchFilter) *gorm.DB {
	query = query.Where("status != ?", UserStatusDeleted)
	// 批量发放仅作用于个体账户;企业账户不持有个人积分
	query = query.Where("account_type = ?", AccountTypePersonal)
	if len(filter.Groups) > 0 {
		groupCol := quoteSQLIdentifier("group")
		query = query.Where(fmt.Sprintf("%s IN ?", groupCol), filter.Groups)
	}
	if filter.Status > 0 {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Role > 0 {
		query = query.Where("role = ?", filter.Role)
	}
	keyword := strings.TrimSpace(filter.Keyword)
	if keyword != "" {
		like := keyword + "%"
		if !common.UsingPostgreSQL {
			query = query.Where("id = ? OR username LIKE ? OR email LIKE ? OR display_name LIKE ?", keyword, like, like, like)
		} else {
			query = query.Where("username LIKE ? OR email LIKE ? OR display_name LIKE ?", like, like, like)
		}
	}
	return query
}

func addUserTimedQuotaTx(tx *gorm.DB, userId int, amount int64, source, sourceRef string, ttl *time.Duration) error {
	var expiresAt *time.Time
	if ttl != nil {
		t := time.Now().Add(*ttl)
		expiresAt = &t
	}
	return addUserQuotaLedgerTx(tx, userId, amount, source, sourceRef, expiresAt)
}

func addUserQuotaLedgerTx(tx *gorm.DB, userId int, amount int64, source, sourceRef string, expiresAt *time.Time) error {
	if userId == 0 {
		return errors.New("user id 为空")
	}
	if amount <= 0 {
		return errors.New("amount 必须大于 0")
	}
	if source == "" {
		return errors.New("source 不能为空")
	}

	// 校验目标用户存在且为个体账户;企业账户不持有个人积分
	var u User
	if err := tx.Select("id", "account_type").Where("id = ?", userId).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("用户不存在")
		}
		return err
	}
	if u.AccountType == AccountTypeEnterprise {
		return errors.New("企业账户不允许写入个人积分")
	}

	row := UserTimedQuota{
		UserId:    userId,
		Amount:    amount,
		Remaining: amount,
		Source:    source,
		SourceRef: sourceRef,
		ExpiresAt: expiresAt,
	}
	if err := tx.Create(&row).Error; err != nil {
		return err
	}
	updates := map[string]interface{}{
		"quota": gorm.Expr("quota + ?", amount),
	}
	if isSubscriptionQuotaSource(source) {
		updates["subscription_quota"] = gorm.Expr("subscription_quota + ?", amount)
	} else {
		updates["timed_quota_total"] = gorm.Expr("timed_quota_total + ?", amount)
	}
	res := tx.Model(&User{}).Where("id = ?", userId).Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errors.New("用户不存在")
	}
	return nil
}

// addOrMergeUserQuotaLedgerTx 与 addUserQuotaLedgerTx 相同，但对「永久批次」（expiresAt=nil）做合并：
// 若已存在同 (user_id, source, source_ref) 的永久行，则原地累加 amount/remaining，不新增行；
// 否则插入一行。用于高频重复发放（如每日签到），避免 user_timed_quotas 逐日膨胀。
//
// 仅合并 expires_at IS NULL 的行——有到期时间的批次各自独立（到期口径不同不能合并）；
// 传入 expiresAt != nil 时退化为普通插入（走 addUserQuotaLedgerTx 语义）。
func addOrMergeUserQuotaLedgerTx(tx *gorm.DB, userId int, amount int64, source, sourceRef string, expiresAt *time.Time) error {
	if userId == 0 {
		return errors.New("user id 为空")
	}
	if amount <= 0 {
		return errors.New("amount 必须大于 0")
	}
	if source == "" {
		return errors.New("source 不能为空")
	}
	// 非永久批次不合并，直接走普通插入
	if expiresAt != nil {
		return addUserQuotaLedgerTx(tx, userId, amount, source, sourceRef, expiresAt)
	}

	// 校验目标用户存在且为个体账户;企业账户不持有个人积分
	var u User
	if err := tx.Select("id", "account_type").Where("id = ?", userId).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("用户不存在")
		}
		return err
	}
	if u.AccountType == AccountTypeEnterprise {
		return errors.New("企业账户不允许写入个人积分")
	}

	// 尝试原地累加已有的永久批次（同 source + source_ref）
	res := tx.Model(&UserTimedQuota{}).
		Where("user_id = ? AND source = ? AND source_ref = ? AND expires_at IS NULL", userId, source, sourceRef).
		Updates(map[string]interface{}{
			"amount":    gorm.Expr("amount + ?", amount),
			"remaining": gorm.Expr("remaining + ?", amount),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		// 首次：插入永久批次行
		row := UserTimedQuota{
			UserId:    userId,
			Amount:    amount,
			Remaining: amount,
			Source:    source,
			SourceRef: sourceRef,
			ExpiresAt: nil,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}

	// 同步用户汇总列（签到走 timed_quota_total，非订阅来源）
	updates := map[string]interface{}{
		"quota": gorm.Expr("quota + ?", amount),
	}
	if isSubscriptionQuotaSource(source) {
		updates["subscription_quota"] = gorm.Expr("subscription_quota + ?", amount)
	} else {
		updates["timed_quota_total"] = gorm.Expr("timed_quota_total + ?", amount)
	}
	ures := tx.Model(&User{}).Where("id = ?", userId).Updates(updates)
	if ures.Error != nil {
		return ures.Error
	}
	if ures.RowsAffected == 0 {
		return errors.New("用户不存在")
	}
	return nil
}

// GetOrderSubscriptionRemaining 返回某笔订阅订单当前在账本中的剩余额度之和。
// 仅统计 source=subscription 且 source_ref=orderNo 的未过期行。用于改单计算「本单剩余」。
func GetOrderSubscriptionRemaining(userId int, orderNo string) (int64, error) {
	var total int64
	err := DB.Model(&UserTimedQuota{}).
		Where("user_id = ? AND source = ? AND source_ref = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)",
			userId, TimedQuotaSourceSubscription, orderNo, time.Now()).
		Select("COALESCE(SUM(remaining), 0)").
		Scan(&total).Error
	return total, err
}

// GetOrderSubscriptionExpiry 返回某笔订阅订单账本行的到期时间（取该单仍有剩余的最早一行）。
// 改单后新发放的额度沿用原到期时间，保持订阅周期不变。返回 nil 表示无活跃行或永久。
func GetOrderSubscriptionExpiry(userId int, orderNo string) (*time.Time, bool, error) {
	var row UserTimedQuota
	err := DB.
		Where("user_id = ? AND source = ? AND source_ref = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)",
			userId, TimedQuotaSourceSubscription, orderNo, time.Now()).
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

// RewriteOrderSubscriptionQuotaTx 改单时改写某笔订阅订单的账本：
// 把该单 source=subscription 的所有活跃行 remaining 清零，再插入一行新账本
// (amount=remaining=newRemaining, 沿用 expiresAt)，并同步 users 镜像列。
//
// 等价于 Respal「就地改写批次」：清零 + 插新行避免多行分摊歧义。
// users.quota / subscription_quota 在 Go 内计算非负差后回写（兼容 SQLite，无 GREATEST）。
func RewriteOrderSubscriptionQuotaTx(tx *gorm.DB, userId int, orderNo string, newRemaining int64, expiresAt *time.Time) error {
	if userId == 0 {
		return errors.New("user id 为空")
	}
	if newRemaining < 0 {
		newRemaining = 0
	}

	// 1. 统计并清零该单现有活跃行的剩余
	var clearSum int64
	if err := tx.Model(&UserTimedQuota{}).
		Where("user_id = ? AND source = ? AND source_ref = ? AND remaining > 0",
			userId, TimedQuotaSourceSubscription, orderNo).
		Select("COALESCE(SUM(remaining), 0)").Scan(&clearSum).Error; err != nil {
		return err
	}
	if clearSum > 0 {
		if err := tx.Model(&UserTimedQuota{}).
			Where("user_id = ? AND source = ? AND source_ref = ? AND remaining > 0",
				userId, TimedQuotaSourceSubscription, orderNo).
			Update("remaining", 0).Error; err != nil {
			return err
		}
	}

	// 2. 插入改单后的新账本行（newRemaining 为 0 时不插，等同清空本单）
	if newRemaining > 0 {
		row := UserTimedQuota{
			UserId:    userId,
			Amount:    newRemaining,
			Remaining: newRemaining,
			Source:    TimedQuotaSourceSubscription,
			SourceRef: orderNo,
			ExpiresAt: expiresAt,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
	}

	// 3. 同步镜像列：净变化 delta = newRemaining - clearSum（可正可负），Go 内非负截断
	delta := newRemaining - clearSum
	if delta == 0 {
		return nil
	}
	var u User
	if err := tx.Select("id", "subscription_quota", "quota").Where("id = ?", userId).First(&u).Error; err != nil {
		return err
	}
	newSub := u.SubscriptionQuota + delta
	if newSub < 0 {
		newSub = 0
	}
	newQuota := u.Quota + delta
	if newQuota < 0 {
		newQuota = 0
	}
	return tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"subscription_quota": newSub,
		"quota":              newQuota,
	}).Error
}

// GetUserTimedQuotaBreakdown 返回用户当前未过期的积分账本明细,
// 用于 GetSelf 等 API 返回前端展示;按到期时间升序(永久排最后).
func GetUserTimedQuotaBreakdown(userId int) ([]UserTimedQuota, error) {
	var rows []UserTimedQuota
	err := DB.
		Where("user_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)", userId, time.Now()).
		Order("CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC").
		Find(&rows).Error
	return rows, err
}

// GetUserTimedQuotaHistory 返回用户的全部积分新增记录(含已耗尽/已过期),按时间倒序分页.
// 账本每行恰好对应一笔积分新增(发放经 addUserQuotaLedgerTx 插入,消费只更新 remaining,
// 从不插入/删除行),因此该列表天然排除 token 消费扣减.
func GetUserTimedQuotaHistory(userId, offset, limit int) ([]UserTimedQuota, int64, error) {
	var rows []UserTimedQuota
	var total int64

	query := DB.Model(&UserTimedQuota{}).Where("user_id = ?", userId)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := query.Order("created_at DESC, id DESC").
		Offset(offset).
		Limit(limit).
		Find(&rows).Error
	return rows, total, err
}

// ExpireTimedQuotas 把已过期账本笔的 remaining 置 0,并同步 users 聚合余额.
//   - 由每天 0 点 cron 调用(AutoExpireTimedQuotas)
//   - 幂等:对已 remaining=0 或 expires_at IS NULL 的行不会处理
func ExpireTimedQuotas() error {
	now := time.Now()
	return DB.Transaction(func(tx *gorm.DB) error {
		// 1) 聚合每个用户即将清零的额度
		type agg struct {
			UserId          int
			SubscriptionSum int64
			TimedSum        int64
		}
		var aggs []agg
		err := tx.Model(&UserTimedQuota{}).
			Select("user_id, SUM(CASE WHEN source IN ? THEN remaining ELSE 0 END) AS subscription_sum, SUM(CASE WHEN source IN ? THEN 0 ELSE remaining END) AS timed_sum", subscriptionQuotaSources(), subscriptionQuotaSources()).
			Where("remaining > 0 AND expires_at IS NOT NULL AND expires_at <= ?", now).
			Group("user_id").
			Scan(&aggs).Error
		if err != nil {
			return err
		}
		if len(aggs) == 0 {
			return nil
		}

		// 2) 同步扣减 users 聚合字段与镜像列 users.quota
		for _, a := range aggs {
			total := a.SubscriptionSum + a.TimedSum
			if total <= 0 {
				continue
			}
			if err := tx.Model(&User{}).Where("id = ?", a.UserId).Updates(map[string]interface{}{
				"subscription_quota": gorm.Expr("GREATEST(subscription_quota - ?, 0)", a.SubscriptionSum),
				"timed_quota_total":  gorm.Expr("GREATEST(timed_quota_total - ?, 0)", a.TimedSum),
				"quota":              gorm.Expr("GREATEST(quota - ?, 0)", total),
			}).Error; err != nil {
				return err
			}
		}

		// 3) 把过期账本笔的 remaining 置 0
		return tx.Model(&UserTimedQuota{}).
			Where("remaining > 0 AND expires_at IS NOT NULL AND expires_at <= ?", now).
			Update("remaining", 0).Error
	})
}
