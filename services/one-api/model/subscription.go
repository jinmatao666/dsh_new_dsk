package model

import (
	"database/sql"
	"fmt"
	"time"

	"gorm.io/gorm"
)

const SubscriptionPeriodDays = 30

// 订阅块状态机(T0-2 队列模型):
//   - active   生效中(队列里当前生效的最高等级块,或尚未被压住的块)
//   - frozen   被更高等级块压住、暂停时钟的低等级块(未 drip 整月冻结顺延,见行为 2/4)
//   - expired  已耗尽/到期退场
//   - void     被退款作废(见退款规则 6.x)
const (
	SubscriptionStatusActive  = "active"
	SubscriptionStatusFrozen  = "frozen"
	SubscriptionStatusExpired = "expired"
	SubscriptionStatusVoid    = "void"
)

// SubscriptionPeriodEnd 计算订阅周期结束时间:对齐到"基准时间当天本地 0 点 + 30 天"
//   - 续期发生在 0 点 cron,基准时间通常是当下;到期日落在 30 天后的 0 点
//   - 首购时基准时间是下单时刻,到期日同样落在 30 天后的 0 点
func SubscriptionPeriodEnd(base time.Time) time.Time {
	return SubscriptionPeriodEndDays(base, SubscriptionPeriodDays)
}

// SubscriptionPeriodEndDays 计算自定义周期(天数)的到期时间:对齐到"基准时间当天本地 0 点 + days 天"。
// days<=0 时回退到默认 30 天,兼容历史未设 period_days 的订阅。
func SubscriptionPeriodEndDays(base time.Time, days int) time.Time {
	if days <= 0 {
		days = SubscriptionPeriodDays
	}
	day := time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, base.Location())
	return day.Add(time.Duration(days) * 24 * time.Hour)
}

type Subscription struct {
	Id                 int       `json:"id" gorm:"primaryKey;comment:订阅ID"`
	UserId             int       `json:"user_id" gorm:"index;not null;comment:用户ID"`
	PackageId          int       `json:"package_id" gorm:"not null;comment:套餐ID"`
	PackageLevel       int       `json:"package_level" gorm:"default:0;comment:套餐等级"`
	BillingCycle       string    `json:"billing_cycle" gorm:"type:varchar(20);not null;comment:订阅周期"`
	Status             string    `json:"status" gorm:"type:varchar(20);default:active;index;comment:订阅状态"`
	QuotaPerPeriod     int64     `json:"quota_per_period" gorm:"type:bigint;not null;comment:每期发放积分额"`
	PeriodDays         int       `json:"period_days" gorm:"default:30;comment:每期天数(发放周期);0/缺省按30天"`
	PeriodsTotal       int       `json:"periods_total" gorm:"not null;comment:总期数"`
	PeriodsUsed        int       `json:"periods_used" gorm:"default:0;comment:已发放期数"`
	CurrentPeriodStart time.Time `json:"current_period_start" gorm:"comment:当前周期开始时间"`
	CurrentPeriodEnd   time.Time `json:"current_period_end" gorm:"index;comment:当前周期结束时间"`
	SubscriptionEnd    time.Time `json:"subscription_end" gorm:"comment:整个订阅结束时间"`
	OrderNo            string    `json:"order_no" gorm:"type:varchar(64);comment:关联支付订单号"`
	// T0-3 队列模型字段:支撑"高等级优先生效、低等级冻结顺延"(见规则文档 2.2 / 8.1-3、行为 2/4)。
	QueueSeq          int        `json:"queue_seq" gorm:"default:0;index;comment:同用户内队列序(越小越先生效),购买时间序作基准"`
	FrozenAt          *time.Time `json:"frozen_at" gorm:"comment:被高等级压住进入冻结的时刻;active 时为空"`
	FrozenRemainDays  int        `json:"frozen_remain_days" gorm:"default:0;comment:冻结时记录的剩余未drip整月天数,恢复时从该时刻重排drip"`
	CreatedAt         time.Time  `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt         time.Time  `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
}

func (Subscription) TableName() string {
	return "subscriptions"
}

func GetActiveSubscriptionsByUserId(userId int) ([]*Subscription, error) {
	var subs []*Subscription
	err := DB.Where("user_id = ? AND status = ?", userId, "active").
		Order("package_level DESC").
		Find(&subs).Error
	return subs, err
}

func GetHighestActiveSubscription(userId int) (*Subscription, error) {
	var sub Subscription
	err := DB.Where("user_id = ? AND status = ?", userId, "active").
		Order("package_level DESC").
		First(&sub).Error
	if err != nil {
		return nil, err
	}
	return &sub, nil
}

func HasYearlyActiveSubscription(userId int) (bool, error) {
	var count int64
	err := DB.Model(&Subscription{}).
		Where("user_id = ? AND status = ? AND billing_cycle = ?", userId, "active", "yearly").
		Count(&count).Error
	return count > 0, err
}

// SubscriptionQueueView 描述用户的订阅队列视图(T1-1):当前生效身份 + 下一个待生效块。
type SubscriptionQueueView struct {
	Current *Subscription   // 当前生效身份:等级最高且生效中(active 且 current_period_end > now)的块;无则为 nil
	Next    *Subscription   // 当前块到期后下一个自动生效的块(active/frozen 中队列序最靠前者);无则为 nil
	Queue   []*Subscription // 完整队列(active + frozen),按 等级降序、队列序升序 排列
}

// ResolveActiveSubscription 解析用户当前生效身份(队列模型核心,见规则文档 2.2 / 8.1-2)。
//   - 当前生效 = 等级最高且仍在生效中(status=active 且 current_period_end > now)的块
//   - 下一个待生效 = 排除当前块后,队列里(active 或 frozen)等级最高、并列取队列序最小的块
//
// 仅 active 块决定"当前生效";frozen 块只进入 Queue/Next 预告,不会被选为 Current。
func ResolveActiveSubscription(userId int) (*SubscriptionQueueView, error) {
	var subs []*Subscription
	err := DB.Where("user_id = ? AND status IN ?", userId, []string{SubscriptionStatusActive, SubscriptionStatusFrozen}).
		Order("package_level DESC, queue_seq ASC").
		Find(&subs).Error
	if err != nil {
		return nil, err
	}

	view := &SubscriptionQueueView{Queue: subs}
	now := time.Now()
	for _, s := range subs {
		if s.Status == SubscriptionStatusActive && s.CurrentPeriodEnd.After(now) {
			view.Current = s
			break // subs 已按等级降序,首个满足者即最高生效块
		}
	}

	for _, s := range subs {
		if view.Current != nil && s.Id == view.Current.Id {
			continue
		}
		view.Next = s // subs 已排序,排除当前块后首个即下一个待生效
		break
	}
	return view, nil
}

func CreateSubscription(sub *Subscription) error {
	return DB.Create(sub).Error
}

// NextSubscriptionQueueSeqTx 返回用户队列里下一个可用的 queue_seq(当前最大值 +1)。
// 队列序决定生效顺序(越小越先生效),按购买时间递增分配;无订阅时从 1 起。
// T0-3 仅落地字段与分配规则,实际的"按队列序生效/冻结"逻辑在 T1 实现。
func NextSubscriptionQueueSeqTx(tx *gorm.DB, userId int) (int, error) {
	var maxSeq sql.NullInt64
	err := tx.Model(&Subscription{}).
		Where("user_id = ?", userId).
		Select("MAX(queue_seq)").
		Scan(&maxSeq).Error
	if err != nil {
		return 0, err
	}
	if !maxSeq.Valid {
		return 1, nil
	}
	return int(maxSeq.Int64) + 1, nil
}

// RunMergeMultiActiveSubscriptionsForTest 暴露存量多订阅合并逻辑供测试调用.
func RunMergeMultiActiveSubscriptionsForTest() error {
	return mergeMultiActiveSubscriptions()
}

// ExpireSubscriptionsAndClearQuotaTx 在事务内把用户所有 active 订阅置为 expired,
// 并清零其 source='subscription' 的积分账本,同步扣减镜像列.
//
// Deprecated（T1/T2 队列模型）：此函数是旧"单一生效订阅+覆盖式清零"的产物,会清退**全部**订阅积分,
// 与多订阅块共存冲突。升级走 FreezeActiveSubscriptionsBelowTx、退款走 RefundOrderSubscriptionTx,
// 都不再调用本函数。保留仅为兼容潜在的外部/应急调用,常规链路勿用。
func ExpireSubscriptionsAndClearQuotaTx(tx *gorm.DB, userId int) error {
	if err := tx.Model(&Subscription{}).
		Where("user_id = ? AND status = ?", userId, "active").
		Update("status", "expired").Error; err != nil {
		return err
	}

	var clearSum int64
	if err := tx.Model(&UserTimedQuota{}).
		Where("user_id = ? AND remaining > 0 AND source = ?", userId, TimedQuotaSourceSubscription).
		Select("COALESCE(SUM(remaining), 0)").
		Scan(&clearSum).Error; err != nil {
		return err
	}
	if clearSum <= 0 {
		return nil
	}

	if err := tx.Model(&UserTimedQuota{}).
		Where("user_id = ? AND remaining > 0 AND source = ?", userId, TimedQuotaSourceSubscription).
		Update("remaining", 0).Error; err != nil {
		return err
	}

	// 读当前镜像值后在 Go 内计算非负差,避免依赖 GREATEST(SQLite 不支持)
	var u User
	if err := tx.Select("id", "subscription_quota", "quota").Where("id = ?", userId).First(&u).Error; err != nil {
		return err
	}
	newSub := u.SubscriptionQuota - clearSum
	if newSub < 0 {
		newSub = 0
	}
	newQuota := u.Quota - clearSum
	if newQuota < 0 {
		newQuota = 0
	}
	return tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"subscription_quota": newSub,
		"quota":              newQuota,
	}).Error
}

// CreateSubscriptionTx 在外部事务内创建订阅,供首购流程把 subscription / quota / recharge_record 三步串行落库.
func CreateSubscriptionTx(tx *gorm.DB, sub *Subscription) error {
	return tx.Create(sub).Error
}

// FreezeActiveSubscriptionsBelowTx 把用户所有等级低于 level 的 active 订阅块置为 frozen(T1-2 冻结)。
// 用于升级:更高等级块插队首生效后,被压住的低等级块暂停时钟(停止 cron 续期),
// 其"当前已 drip 月"的积分不动、按原到期日自然失效(钱包模型);只有未 drip 的整月随冻结顺延,
// 待高等级块到期后由 restoreNextFrozenSubscriptionTx 从恢复时刻重排 drip(见规则文档行为 2/4)。
func FreezeActiveSubscriptionsBelowTx(tx *gorm.DB, userId, level int, now time.Time) error {
	return tx.Model(&Subscription{}).
		Where("user_id = ? AND status = ? AND package_level < ?", userId, SubscriptionStatusActive, level).
		Updates(map[string]interface{}{
			"status":    SubscriptionStatusFrozen,
			"frozen_at": now,
		}).Error
}

// restoreNextFrozenSubscriptionTx 在事务内恢复队列里下一个待生效的 frozen 块(T1-2 恢复)。
// 选取规则:等级最高、并列取队列序最小的 frozen 块。恢复 = 置 active + 从 now 重排一期 drip:
// PeriodsUsed++、current_period 窗口从 now 起算,按该块原等级额度发放本期积分(钱包叠加)。
// 无 frozen 块时静默返回。仅在用户已无 active 块时调用(由调用方保证)。
func restoreNextFrozenSubscriptionTx(tx *gorm.DB, userId int, now time.Time) error {
	var frozen []*Subscription
	if err := tx.Where("user_id = ? AND status = ?", userId, SubscriptionStatusFrozen).
		Order("package_level DESC, queue_seq ASC").
		Find(&frozen).Error; err != nil {
		return err
	}
	if len(frozen) == 0 {
		return nil
	}
	sub := frozen[0]
	// 防御:无剩余期数的 frozen 块直接过期,不应再生效
	if sub.PeriodsUsed >= sub.PeriodsTotal {
		return tx.Model(&Subscription{}).Where("id = ?", sub.Id).
			Updates(map[string]interface{}{"status": SubscriptionStatusExpired, "frozen_at": nil}).Error
	}
	periodEnd := SubscriptionPeriodEndDays(now, sub.PeriodDays)
	if err := tx.Model(&Subscription{}).Where("id = ?", sub.Id).Updates(map[string]interface{}{
		"status":               SubscriptionStatusActive,
		"frozen_at":            nil,
		"periods_used":         sub.PeriodsUsed + 1,
		"current_period_start": now,
		"current_period_end":   periodEnd,
	}).Error; err != nil {
		return err
	}
	if sub.QuotaPerPeriod > 0 {
		end := periodEnd
		if err := addUserQuotaLedgerTx(tx, userId, sub.QuotaPerPeriod, TimedQuotaSourceSubscription, sub.OrderNo, &end); err != nil {
			return err
		}
	}
	return nil
}

// RefundOrderSubscriptionTx 在事务内按订单回收订阅权益(T2,见规则文档 §6.2,退队首/中间/队尾通用)。
// 返回本单清掉的订阅积分余量(已花部分不倒扣,天然不为负)。流程:
//  1. 清零该单 source=subscription、source_ref=orderNo 的积分余量(复用 RewriteOrderSubscriptionQuotaTx, newRemaining=0)
//  2. 该单对应的身份块置 void(从队列移除)
//  3. 其后所有 frozen 块按 queue_seq 升序紧凑前移(去空洞;drip 计划在恢复时才重排)
//  4. 若被退块原为 active 且用户已无其它 active,恢复队首 frozen 块为新当前身份(复用 restoreNextFrozenSubscriptionTx)
func RefundOrderSubscriptionTx(tx *gorm.DB, userId int, orderNo string, now time.Time) (int64, error) {
	// 1. 该单剩余订阅积分余量(清零前先量出,作为退款额)
	var refundQuota int64
	if err := tx.Model(&UserTimedQuota{}).
		Where("user_id = ? AND source = ? AND source_ref = ? AND remaining > 0",
			userId, TimedQuotaSourceSubscription, orderNo).
		Select("COALESCE(SUM(remaining), 0)").Scan(&refundQuota).Error; err != nil {
		return 0, err
	}
	if err := RewriteOrderSubscriptionQuotaTx(tx, userId, orderNo, 0, nil); err != nil {
		return 0, err
	}

	// 2. 定位被退身份块(可能 active 或 frozen);无关联订阅块时只清积分即可
	var target Subscription
	err := tx.Where("user_id = ? AND order_no = ? AND status IN ?",
		userId, orderNo, []string{SubscriptionStatusActive, SubscriptionStatusFrozen}).
		First(&target).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return refundQuota, nil
		}
		return 0, err
	}
	wasActive := target.Status == SubscriptionStatusActive
	if err := tx.Model(&Subscription{}).Where("id = ?", target.Id).Updates(map[string]interface{}{
		"status":    SubscriptionStatusVoid,
		"frozen_at": nil,
	}).Error; err != nil {
		return 0, err
	}

	// 3. 剩余 frozen 块按 queue_seq 升序紧凑重排(从 1 起),消除被退块留下的空洞
	var frozen []*Subscription
	if err := tx.Where("user_id = ? AND status = ?", userId, SubscriptionStatusFrozen).
		Order("queue_seq ASC").Find(&frozen).Error; err != nil {
		return 0, err
	}
	for i, f := range frozen {
		newSeq := i + 1
		if f.QueueSeq != newSeq {
			if err := tx.Model(&Subscription{}).Where("id = ?", f.Id).
				Update("queue_seq", newSeq).Error; err != nil {
				return 0, err
			}
		}
	}

	// 4. 退的是当前生效块时,若已无其它 active,恢复队首 frozen 块顶上来
	if wasActive {
		var activeCnt int64
		if err := tx.Model(&Subscription{}).
			Where("user_id = ? AND status = ?", userId, SubscriptionStatusActive).
			Count(&activeCnt).Error; err != nil {
			return 0, err
		}
		if activeCnt == 0 {
			if err := restoreNextFrozenSubscriptionTx(tx, userId, now); err != nil {
				return 0, err
			}
		}
	}
	return refundQuota, nil
}

// AlignSubscriptionPeriodsTx 同 AlignSubscriptionPeriods,但接受外部事务句柄.
func AlignSubscriptionPeriodsTx(tx *gorm.DB, userId int, periodEnd time.Time) error {
	return tx.Model(&Subscription{}).
		Where("user_id = ? AND status = ?", userId, "active").
		Update("current_period_end", periodEnd).Error
}

func UpdateSubscription(sub *Subscription) error {
	return DB.Save(sub).Error
}

// GetUsersWithExpiredHighestPeriod finds user IDs whose highest-level active subscription has current_period_end <= now
func GetUsersWithExpiredHighestPeriod() ([]int, error) {
	now := time.Now()
	var userIds []int

	// Subquery: for each user, get the max package_level among active subscriptions
	// Then check if that subscription's current_period_end <= now
	rows, err := DB.Raw(`
		SELECT DISTINCT s1.user_id
		FROM subscriptions s1
		INNER JOIN (
			SELECT user_id, MAX(package_level) as max_level
			FROM subscriptions
			WHERE status = 'active'
			GROUP BY user_id
		) s2 ON s1.user_id = s2.user_id AND s1.package_level = s2.max_level
		INNER JOIN users u ON u.id = s1.user_id AND u.account_type = ?
		WHERE s1.status = 'active' AND s1.current_period_end <= ?
	`, AccountTypePersonal, now).Rows()

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var uid int
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		userIds = append(userIds, uid)
	}
	return userIds, nil
}

// AlignSubscriptionPeriods aligns all active subscriptions for a user to the given period_end
func AlignSubscriptionPeriods(userId int, periodEnd time.Time) error {
	return DB.Model(&Subscription{}).
		Where("user_id = ? AND status = ?", userId, "active").
		Update("current_period_end", periodEnd).Error
}

// ProcessUserSubscriptionRenewal handles the unified renewal for a user:
// 1. Zero out user quota
// 2. For each active subscription: renew if periods remain, expire if not
// 3. Sum up all renewed quotas, set as new user quota
//
// 注意:免费额度(QuotaForMonthlyFree)由独立的 IssueMonthlyFreeQuotas 流程处理,
//
//	仅发放给无 active 订阅的用户;此函数不再叠加免费额度。
func ProcessUserSubscriptionRenewal(userId int) error {
	// 二次防御:企业账户即使因数据错乱被候选 SQL 误选,也不会发放订阅积分
	var u User
	if err := DB.Select("id", "account_type").Where("id = ?", userId).First(&u).Error; err != nil {
		return fmt.Errorf("查询用户失败: %w", err)
	}
	if u.AccountType != AccountTypePersonal {
		return nil
	}

	now := time.Now()
	// 队列模型续期(T1-2):只处理 active 块(冻结块暂停时钟、不续期)。约定任意时刻 ≤1 个 active 块,
	// 但为兼容存量多 active 数据仍循环处理。各笔积分按自身 order_no 与到期日独立发放(钱包叠加,不覆盖)。
	// 续期完成后若用户已无 active 块、但仍有 frozen 块,则恢复队列里下一个 frozen 块(高等级块用尽→低等级回落)。
	if err := DB.Transaction(func(tx *gorm.DB) error {
		var subs []*Subscription
		if err := tx.Where("user_id = ? AND status = ?", userId, SubscriptionStatusActive).
			Order("package_level DESC").Find(&subs).Error; err != nil {
			return fmt.Errorf("获取用户订阅失败: %w", err)
		}

		activeRemaining := 0
		for _, sub := range subs {
			// 仅对已到期的当前周期续期/过期;未到期的 active 块保持不变
			if sub.CurrentPeriodEnd.After(now) {
				activeRemaining++
				continue
			}
			if sub.PeriodsUsed < sub.PeriodsTotal {
				periodEnd := SubscriptionPeriodEndDays(now, sub.PeriodDays)
				if err := tx.Model(&Subscription{}).Where("id = ?", sub.Id).Updates(map[string]interface{}{
					"periods_used":         sub.PeriodsUsed + 1,
					"current_period_start": now,
					"current_period_end":   periodEnd,
				}).Error; err != nil {
					return fmt.Errorf("更新订阅 %d 失败: %w", sub.Id, err)
				}
				activeRemaining++
				if sub.QuotaPerPeriod > 0 {
					end := periodEnd
					if err := addUserQuotaLedgerTx(tx, userId, sub.QuotaPerPeriod, TimedQuotaSourceSubscription, sub.OrderNo, &end); err != nil {
						return fmt.Errorf("发放续期积分失败: %w", err)
					}
				}
			} else {
				if err := tx.Model(&Subscription{}).Where("id = ?", sub.Id).
					Update("status", SubscriptionStatusExpired).Error; err != nil {
					return fmt.Errorf("过期订阅 %d 失败: %w", sub.Id, err)
				}
			}
		}

		// 高等级块用尽退场后,从恢复时刻重排下一个 frozen 块的 drip(见行为 2/4)。
		if activeRemaining == 0 {
			if err := restoreNextFrozenSubscriptionTx(tx, userId, now); err != nil {
				return fmt.Errorf("恢复冻结订阅失败: %w", err)
			}
		}
		return nil
	}); err != nil {
		return err
	}

	return nil
}
