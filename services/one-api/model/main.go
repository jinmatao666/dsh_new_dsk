package model

import (
	"database/sql"
	"fmt"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/env"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/random"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"os"
	"strings"
	"time"
)

var DB *gorm.DB
var LOG_DB *gorm.DB

// ACCOUNT_DB 账号中心独立库连接（account_center）。通过 ACCOUNT_SQL_DSN 配置，
// 与主业务库物理隔离。现在落 MySQL，将来把 DSN 换成 postgres:// 即可平滑迁云 PG。
var ACCOUNT_DB *gorm.DB

func CreateRootAccountIfNeed() error {
	var user User
	//if user.Status != util.UserStatusEnabled {
	if err := DB.First(&user).Error; err != nil {
		logger.SysLog("no user exists, creating a root user for you: username is root, password is 123456")
		hashedPassword, err := common.Password2Hash("123456")
		if err != nil {
			return err
		}
		accessToken := random.GetUUID()
		if config.InitialRootAccessToken != "" {
			accessToken = config.InitialRootAccessToken
		}
		initialRootQuota := int64(500000000000000)
		rootUser := User{
			Username:    "root",
			Password:    hashedPassword,
			Role:        RoleRootUser,
			Status:      UserStatusEnabled,
			DisplayName: "Root User",
			AccessToken: accessToken,
		}
		if err := DB.Create(&rootUser).Error; err != nil {
			return err
		}
		if err := AddUserTimedQuota(rootUser.Id, initialRootQuota, TimedQuotaSourceAdmin, "initial_root", nil); err != nil {
			return err
		}
		if config.InitialRootToken != "" {
			logger.SysLog("creating initial root token as requested")
			token := Token{
				Id:             1,
				UserId:         rootUser.Id,
				Key:            config.InitialRootToken,
				Status:         TokenStatusEnabled,
				Name:           "Initial Root Token",
				CreatedTime:    helper.GetTimestamp(),
				AccessedTime:   helper.GetTimestamp(),
				ExpiredTime:    -1,
				RemainQuota:    initialRootQuota,
				UnlimitedQuota: true,
			}
			DB.Create(&token)
		}
	}
	return nil
}

// chooseDB 选库并打开连接。
//
// primary 表示这是否是「主业务库」(SQL_DSN)。只有主库才允许设置全局方言开关
// (common.UsingPostgreSQL / UsingMySQL / UsingSQLite)——这些开关被 cache.go /
// log.go 等处用来切换手写 SQL 的方言(如标识符引用 `key` vs "key")。
//
// 副连接(LOG_SQL_DSN / ACCOUNT_SQL_DSN)若与主库异构(例如主库 MySQL、账号中心 PG),
// 绝不能改写全局开关,否则会把主库的 SQL 生成污染成另一种方言,导致 WHERE "key"=...
// 在 MySQL 下被当成字符串字面量、令牌校验整体失效。account_*.go 只用 GORM 构造器、
// 不含手写方言 SQL,故副连接无需也不应触碰全局开关。
func chooseDB(envName string, primary bool) (*gorm.DB, error) {
	dsn := os.Getenv(envName)

	switch {
	case strings.HasPrefix(dsn, "postgres://"), strings.HasPrefix(dsn, "postgresql://"):
		// Use PostgreSQL
		return openPostgreSQL(dsn, primary)
	case dsn != "":
		// Use MySQL
		return openMySQL(dsn, primary)
	default:
		// Use SQLite
		return openSQLite(primary)
	}
}

func openPostgreSQL(dsn string, primary bool) (*gorm.DB, error) {
	logger.SysLog("using PostgreSQL as database")
	if primary {
		common.UsingPostgreSQL = true
	}
	return gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true, // disables implicit prepared statement usage
	}), &gorm.Config{
		PrepareStmt: true, // precompile SQL
	})
}

func openMySQL(dsn string, primary bool) (*gorm.DB, error) {
	logger.SysLog("using MySQL as database")
	if primary {
		common.UsingMySQL = true
	}

	// 确保 DSN 包含 parseTime=True 参数，这样 GORM 才能正确处理 datetime 类型
	if !strings.Contains(dsn, "parseTime=") {
		if strings.Contains(dsn, "?") {
			dsn += "&parseTime=True"
		} else {
			dsn += "?parseTime=True"
		}
	}

	// 确保 DSN 包含时区参数
	if !strings.Contains(dsn, "loc=") {
		if strings.Contains(dsn, "?") {
			dsn += "&loc=Asia%2FShanghai"
		} else {
			dsn += "?loc=Asia%2FShanghai"
		}
	}

	logger.SysLog("MySQL DSN: " + strings.Split(dsn, "@")[0] + "@***")

	return gorm.Open(mysql.Open(dsn), &gorm.Config{
		PrepareStmt: true, // precompile SQL
	})
}

func openSQLite(primary bool) (*gorm.DB, error) {
	logger.SysLog("SQL_DSN not set, using SQLite as database")
	if primary {
		common.UsingSQLite = true
	}
	dsn := fmt.Sprintf("%s?_busy_timeout=%d", common.SQLitePath, common.SQLiteBusyTimeout)
	return gorm.Open(sqlite.Open(dsn), &gorm.Config{
		PrepareStmt: true, // precompile SQL
	})
}

func InitDB() {
	var err error
	DB, err = chooseDB("SQL_DSN", true)
	if err != nil {
		logger.FatalLog("failed to initialize database: " + err.Error())
		return
	}

	sqlDB := setDBConns(DB)

	// 初始化账号中心数据库（如果配置了）
	if os.Getenv("ACCOUNT_SQL_DSN") != "" {
		logger.SysLog("initializing account center database")
		ACCOUNT_DB, err = chooseDB("ACCOUNT_SQL_DSN", false)
		if err != nil {
			logger.FatalLog("failed to initialize account center database: " + err.Error())
			return
		}
		setDBConns(ACCOUNT_DB)
		logger.SysLog("account center database initialized")
	}

	if !config.IsMasterNode {
		return
	}

	if common.UsingMySQL {
		_, _ = sqlDB.Exec("DROP INDEX idx_channels_key ON channels;") // TODO: delete this line when most users have upgraded
	}

	logger.SysLog("database migration started")
	if err = migrateDB(); err != nil {
		logger.FatalLog("failed to migrate database: " + err.Error())
		return
	}
	logger.SysLog("database migrated")

	// 模型配置改为全手动登记,不再自动把渠道/ability 派生模型补登到 ModelDefinition。
	// (原 BackfillModelDefinitions 已停用)

	// 初始化用户提供者
	providerType := env.String("USER_PROVIDER_TYPE", "current")
	if os.Getenv("ACCOUNT_SQL_DSN") != "" {
		providerType = "external" // 如果配置了账号中心数据库，自动使用外部提供者
	}
	if err = InitUserProvider(providerType); err != nil {
		logger.FatalLog("failed to initialize user provider: " + err.Error())
		return
	}
	logger.SysLog("user provider initialized: " + providerType)
}

func migrateDB() error {
	var err error
	if err = DB.AutoMigrate(&Channel{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Token{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&ProvinceIdentity{}, &ProvinceLaunchCode{}, &ProvinceDeviceToken{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&User{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Option{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Redemption{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Ability{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&ModelDefinition{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Log{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserPromptAudit{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Channel{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Order{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Invoice{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Organization{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OrgMember{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OrgInvitation{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Subscription{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&RechargePackage{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&RechargeRecord{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OrderChangeLog{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Skill{}); err != nil {
		return err
	}
	if err = migrateSkillCategorySchema(); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&PersonalSkill{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Feedback{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&ClientEvent{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&AdminOperationLog{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserTimedQuota{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&CustomDashboardChart{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OperationDashboard{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OrgTimedQuota{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&AccountTypeChange{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OrgDepartment{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OrgMemberLimit{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&OrgAuditLog{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Activity{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&ActivityParticipation{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&MemberIdentity{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserCrowd{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserTag{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserTagRelation{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&UserCoupon{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&InviteRecord{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&InfluencerCode{}); err != nil {
		return err
	}
	// 兑换码唯一键已从「手机号」改为「手机号+渠道」复合唯一索引。
	// AutoMigrate 会建复合索引但不会删旧的单列唯一索引，需显式清理，否则旧索引仍限制"一手机一码"。
	if mig := DB.Migrator(); mig.HasIndex(&InfluencerCode{}, "idx_influencer_codes_issuer_phone") {
		if err = mig.DropIndex(&InfluencerCode{}, "idx_influencer_codes_issuer_phone"); err != nil {
			logger.SysError("删除兑换码旧手机号唯一索引失败: " + err.Error())
		}
	}
	if err = DB.AutoMigrate(&RedeemRecord{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&RewardSettlement{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&RewardSettlementItem{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&VersionNote{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&VersionRelease{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&Notification{}); err != nil {
		return err
	}
	if err = DB.AutoMigrate(&NotificationRead{}); err != nil {
		return err
	}
	// 添加表注释（仅 MySQL 支持）
	if common.UsingMySQL {
		DB.Exec("ALTER TABLE `organizations` COMMENT '企业/组织表'")
		DB.Exec("ALTER TABLE `org_members` COMMENT '企业成员关系表'")
		DB.Exec("ALTER TABLE `org_invitations` COMMENT '企业邀请码表'")
		DB.Exec("ALTER TABLE `subscriptions` COMMENT '用户订阅记录表'")
		DB.Exec("ALTER TABLE `recharge_packages` COMMENT '充值套餐配置表'")
		DB.Exec("ALTER TABLE `orders` COMMENT '支付订单表'")
		DB.Exec("ALTER TABLE `skills` COMMENT '技能表'")
		DB.Exec("ALTER TABLE `skill_category_types` COMMENT 'skill分类类型表'")
		DB.Exec("ALTER TABLE `skill_categories` COMMENT 'skill分类项表'")
		DB.Exec("ALTER TABLE `skill_category_relations` COMMENT '公库skill与分类关系表'")
		DB.Exec("ALTER TABLE `personal_skills` COMMENT '用户个人技能库'")
		DB.Exec("ALTER TABLE `feedbacks` COMMENT '用户反馈'")
		DB.Exec("ALTER TABLE `client_events` COMMENT '客户端行为事件'")
		DB.Exec("ALTER TABLE `admin_operation_logs` COMMENT '后台操作记录'")
		DB.Exec("ALTER TABLE `user_timed_quotas` COMMENT '用户定时积分账本(每笔独立到期)'")
		DB.Exec("ALTER TABLE `org_timed_quotas` COMMENT '企业定时积分账本(每笔独立到期)'")
		DB.Exec("ALTER TABLE `account_type_changes` COMMENT '账户类型迁移审计'")
		DB.Exec("ALTER TABLE `org_departments` COMMENT '企业部门(树状)'")
		DB.Exec("ALTER TABLE `org_member_limits` COMMENT '企业成员日/月用量限额'")
		DB.Exec("ALTER TABLE `org_audit_logs` COMMENT '企业管理操作审计'")
		DB.Exec("ALTER TABLE `activities` COMMENT '活动管理'")
		DB.Exec("ALTER TABLE `activity_participations` COMMENT '活动参与记录表'")
		DB.Exec("ALTER TABLE `user_crowds` COMMENT '用户人群定义表'")
		DB.Exec("ALTER TABLE `user_tags` COMMENT '用户标签定义表'")
		DB.Exec("ALTER TABLE `user_tag_relations` COMMENT '用户与标签关联表'")
		DB.Exec("ALTER TABLE `influencer_codes` COMMENT '达人兑换码定义(瘦表:码→发码人映射)'")
		DB.Exec("ALTER TABLE `redeem_records` COMMENT '达人兑换码兑换归因流水'")
	}
	// PR2: 把存量 users.quota 一次性迁移到 user_timed_quotas 永久行.
	// 依赖前置:本次部署内所有写入路径已切到新 API(注册/邀请/兑换/充值/管理员/续期/免费/退款),
	// 因此迁移与读写切换原子完成,不会出现 PR1→PR2 中间态导致的余额回弹.
	// 迁移本身幂等(只处理 quota > 0 AND subscription_quota = 0 AND timed_quota_total = 0 的用户),多节点重复启动安全.
	if err = migrateLegacyQuotaToTimedQuota(); err != nil {
		return fmt.Errorf("迁移老 quota 到定时积分账本失败: %w", err)
	}
	if err = backfillSubscriptionQuotaLedger(); err != nil {
		return fmt.Errorf("补齐订阅积分账本失败: %w", err)
	}
	// T0-2 放开"单一生效订阅"约束:队列模型允许同一用户多条 active 订阅共存
	// (一条生效、其余冻结排队,见规则文档 2.2 / 8.1-1)。因此不再在启动时强制合并多订阅。
	// mergeMultiActiveSubscriptions 保留为可手动调用的收敛工具(RunMergeMultiActiveSubscriptionsForTest),
	// 但不再作为启动迁移自动执行——自动合并会吞掉排队中的低等级块,与队列模型直接冲突。
	// 历史 org_members 中的有效成员一次性迁为 enterprise 身份(幂等,有审计行就跳过).
	if err = MigrateEnterpriseAccountsV0(); err != nil {
		return fmt.Errorf("迁移历史企业成员失败: %w", err)
	}
	// organizations.quota 标量迁入 org_timed_quotas 永久行(幂等,按企业是否已有 migration 行判断).
	if err = MigrateOrgQuotaToLedgerV0(); err != nil {
		return fmt.Errorf("迁移企业额度到账本失败: %w", err)
	}
	return nil
}

// migrateLegacyQuotaToTimedQuota 把存量 users.quota 一次性迁移到新余额模型.
//   - 幂等:已迁移过的用户(subscription_quota > 0 或 timed_quota_total > 0)不会被再次处理
//   - 仅在主节点首次启动后执行一次;后续启动用户大多已迁移,扫描 + 写入开销很小
//   - active 订阅用户先按当前 active 订阅周期额度上限切出 subscription_quota,
//     剩余部分才迁入永久 timed 账本,避免下次续期把历史订阅余额再叠加一遍
//
// 必须在「所有写入路径已切到新 API」的同一次部署里调用,否则 PR1→PR2 之间用户消费仅扣 quota 列,
// 账本永久行不变,切到新读取时余额会凭空回弹.
//
// 多节点考量:逐用户事务内锁定 users 行并重查 timed_quota_total,重复启动不会重复插账本.
func migrateLegacyQuotaToTimedQuota() error {
	// 先做幂等检查:确认确实有需要迁移的用户;空场景早退,避免无意义的事务
	var pending int64
	if err := DB.Model(&User{}).
		Where("quota > 0 AND subscription_quota = 0 AND timed_quota_total = 0").
		Count(&pending).Error; err != nil {
		return err
	}
	if pending == 0 {
		return nil
	}
	logger.SysLogf("quota migration: 发现 %d 个用户待迁移到 user_timed_quotas", pending)

	type legacyRow struct {
		Id    int
		Quota int64
	}
	var rows []legacyRow
	if err := DB.Model(&User{}).
		Where("quota > 0 AND subscription_quota = 0 AND timed_quota_total = 0").
		Select("id, quota").
		Find(&rows).Error; err != nil {
		return err
	}

	now := time.Now()
	for _, r := range rows {
		err := DB.Transaction(func(tx *gorm.DB) error {
			var current User
			query := tx.Select("id, quota, subscription_quota, timed_quota_total").Where("id = ?", r.Id)
			if !common.UsingSQLite {
				query = query.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := query.First(&current).Error; err != nil {
				return err
			}
			if current.SubscriptionQuota > 0 || current.TimedQuotaTotal > 0 || current.Quota <= 0 {
				return nil
			}
			subscriptionQuota, err := getActiveSubscriptionQuotaCapTx(tx, r.Id)
			if err != nil {
				return err
			}
			if subscriptionQuota > current.Quota {
				subscriptionQuota = current.Quota
			}
			timedQuota := current.Quota - subscriptionQuota
			if subscriptionQuota > 0 {
				expiresAt, source, sourceRef := inferSubscriptionLedgerMetaTx(tx, r.Id, now)
				row := UserTimedQuota{
					UserId:    r.Id,
					Amount:    subscriptionQuota,
					Remaining: subscriptionQuota,
					Source:    source,
					SourceRef: sourceRef,
					ExpiresAt: expiresAt,
					CreatedAt: now,
				}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			}
			if timedQuota > 0 {
				row := UserTimedQuota{
					UserId:    r.Id,
					Amount:    timedQuota,
					Remaining: timedQuota,
					Source:    TimedQuotaSourceMigration,
					SourceRef: "v1_initial",
					CreatedAt: now,
				}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			}
			return tx.Model(&User{}).Where("id = ? AND subscription_quota = 0 AND timed_quota_total = 0", r.Id).
				Updates(map[string]interface{}{
					"subscription_quota": subscriptionQuota,
					"timed_quota_total":  timedQuota,
					"quota":              current.Quota,
				}).Error
		})
		if err != nil {
			logger.SysErrorf("quota migration: 用户 %d 迁移失败: %v", r.Id, err)
		}
	}
	logger.SysLog("quota migration: 完成(逐用户事务)")
	return nil
}

func backfillSubscriptionQuotaLedger() error {
	type row struct {
		Id                int
		SubscriptionQuota int64
	}
	var rows []row
	err := DB.Model(&User{}).
		Where("subscription_quota > 0").
		Where(`NOT EXISTS (
			SELECT 1 FROM user_timed_quotas tq
			WHERE tq.user_id = users.id
			  AND tq.remaining > 0
			  AND tq.source IN ?
		)`, subscriptionQuotaSources()).
		Select("id, subscription_quota").
		Find(&rows).Error
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	logger.SysLogf("subscription ledger backfill: 发现 %d 个用户待补齐", len(rows))
	now := time.Now()
	for _, r := range rows {
		err := DB.Transaction(func(tx *gorm.DB) error {
			var u User
			query := tx.Select("id", "subscription_quota").Where("id = ?", r.Id)
			if !common.UsingSQLite {
				query = query.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := query.First(&u).Error; err != nil {
				return err
			}
			if u.SubscriptionQuota <= 0 {
				return nil
			}
			var count int64
			if err := tx.Model(&UserTimedQuota{}).
				Where("user_id = ? AND remaining > 0 AND source IN ?", r.Id, subscriptionQuotaSources()).
				Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return nil
			}
			expiresAt, source, sourceRef := inferSubscriptionLedgerMetaTx(tx, r.Id, now)
			row := UserTimedQuota{
				UserId:    r.Id,
				Amount:    u.SubscriptionQuota,
				Remaining: u.SubscriptionQuota,
				Source:    source,
				SourceRef: sourceRef,
				ExpiresAt: expiresAt,
				CreatedAt: now,
			}
			return tx.Create(&row).Error
		})
		if err != nil {
			logger.SysErrorf("subscription ledger backfill: 用户 %d 补齐失败: %v", r.Id, err)
		}
	}
	return nil
}

// mergeMultiActiveSubscriptions 把存量持有 ≥2 条 active 订阅的用户收敛为单条:
//   - 保留 package_level 最高、并列时 current_period_end 最晚的一条
//   - 其余 active 订阅置为 expired
//   - 保留订阅的 current_period_end 对齐为原多条中最晚的到期日(时间顺延)
//   - 不改动已发放积分余额,仅收敛订阅条数
//   - 幂等:已只剩 ≤1 条 active 的用户跳过;事务内逐用户处理
//
// 注意(T0-2):队列模型已放开"单一生效订阅",此函数不再作为启动迁移自动执行,
// 仅保留为应急的手动收敛工具(经 RunMergeMultiActiveSubscriptionsForTest 暴露)。
// 切勿在常规链路调用——会吞掉排队中的低等级冻结块。
func mergeMultiActiveSubscriptions() error {
	type row struct {
		UserId int
		Cnt    int
	}
	var rows []row
	err := DB.Model(&Subscription{}).
		Select("user_id, COUNT(*) as cnt").
		Where("status = ?", "active").
		Group("user_id").
		Having("COUNT(*) > 1").
		Scan(&rows).Error
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	logger.SysLogf("merge multi active subscriptions: 发现 %d 个用户待收敛", len(rows))

	for _, r := range rows {
		err := DB.Transaction(func(tx *gorm.DB) error {
			var subs []Subscription
			if err := tx.Where("user_id = ? AND status = ?", r.UserId, "active").
				Find(&subs).Error; err != nil {
				return err
			}
			if len(subs) <= 1 {
				return nil
			}
			// 选保留项:level 最高,并列取 current_period_end 最晚;同时求所有 active 中最晚到期日
			keep := &subs[0]
			latestEnd := subs[0].CurrentPeriodEnd
			for i := 1; i < len(subs); i++ {
				s := &subs[i]
				if s.CurrentPeriodEnd.After(latestEnd) {
					latestEnd = s.CurrentPeriodEnd
				}
				if s.PackageLevel > keep.PackageLevel ||
					(s.PackageLevel == keep.PackageLevel && s.CurrentPeriodEnd.After(keep.CurrentPeriodEnd)) {
					keep = s
				}
			}
			// 其余订阅置 expired
			for i := range subs {
				if subs[i].Id == keep.Id {
					continue
				}
				if err := tx.Model(&Subscription{}).Where("id = ?", subs[i].Id).
					Update("status", "expired").Error; err != nil {
					return err
				}
			}
			// 保留项到期日顺延到最晚
			if latestEnd.After(keep.CurrentPeriodEnd) {
				if err := tx.Model(&Subscription{}).Where("id = ?", keep.Id).
					Update("current_period_end", latestEnd).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			logger.SysErrorf("merge multi active subscriptions: 用户 %d 收敛失败: %v", r.UserId, err)
		}
	}
	return nil
}

func inferSubscriptionLedgerMetaTx(tx *gorm.DB, userId int, now time.Time) (*time.Time, string, string) {
	var periodEnd sql.NullTime
	err := tx.Model(&Subscription{}).
		Where("user_id = ? AND status = ?", userId, "active").
		Select("MIN(current_period_end)").
		Scan(&periodEnd).Error
	if err == nil && periodEnd.Valid && !periodEnd.Time.IsZero() {
		return &periodEnd.Time, TimedQuotaSourceSubscription, "migration_subscription"
	}
	var u User
	if err := tx.Select("last_free_quota_at").Where("id = ?", userId).First(&u).Error; err == nil && u.LastFreeQuotaAt != nil {
		expiresAt := u.LastFreeQuotaAt.Add(FreeQuotaIntervalDays * 24 * time.Hour)
		if expiresAt.Before(now) {
			expiresAt = SubscriptionPeriodEnd(now)
		}
		return &expiresAt, TimedQuotaSourceMonthlyFree, "migration_monthly_free"
	}
	expiresAt := SubscriptionPeriodEnd(now)
	return &expiresAt, TimedQuotaSourceSubscription, "migration_subscription"
}

func getActiveSubscriptionQuotaCapTx(tx *gorm.DB, userId int) (int64, error) {
	var cap sql.NullInt64
	err := tx.Model(&Subscription{}).
		Where("user_id = ? AND status = ?", userId, "active").
		Select("COALESCE(SUM(quota_per_period), 0)").
		Scan(&cap).Error
	if err != nil {
		return 0, err
	}
	if !cap.Valid {
		return 0, nil
	}
	return cap.Int64, nil
}

func InitLogDB() {
	if os.Getenv("LOG_SQL_DSN") == "" {
		LOG_DB = DB
		return
	}

	logger.SysLog("using secondary database for table logs")
	var err error
	LOG_DB, err = chooseDB("LOG_SQL_DSN", false)
	if err != nil {
		logger.FatalLog("failed to initialize secondary database: " + err.Error())
		return
	}

	setDBConns(LOG_DB)

	if !config.IsMasterNode {
		return
	}

	logger.SysLog("secondary database migration started")
	err = migrateLOGDB()
	if err != nil {
		logger.FatalLog("failed to migrate secondary database: " + err.Error())
		return
	}
	logger.SysLog("secondary database migrated")
}

func migrateLOGDB() error {
	var err error
	if err = LOG_DB.AutoMigrate(&Log{}); err != nil {
		return err
	}
	return nil
}

// InitAccountDB 初始化账号中心独立库连接，仿 InitLogDB。
// ACCOUNT_SQL_DSN 未配置时跳过（账号中心尚未启用，不影响现有功能）。
func InitAccountDB() {
	if os.Getenv("ACCOUNT_SQL_DSN") == "" {
		logger.SysLog("ACCOUNT_SQL_DSN 未配置，账号中心未启用")
		return
	}

	logger.SysLog("using dedicated database for account center")
	var err error
	ACCOUNT_DB, err = chooseDB("ACCOUNT_SQL_DSN", false)
	if err != nil {
		logger.FatalLog("账号中心数据库初始化失败: " + err.Error())
		return
	}

	setDBConns(ACCOUNT_DB)

	if !config.IsMasterNode {
		return
	}

	logger.SysLog("account center database migration started")
	if err = migrateAccountDB(); err != nil {
		logger.FatalLog("账号中心数据库迁移失败: " + err.Error())
		return
	}
	logger.SysLog("account center database migrated")
}

func migrateAccountDB() error {
	if err := ACCOUNT_DB.AutoMigrate(&Account{}); err != nil {
		return err
	}
	if err := ACCOUNT_DB.AutoMigrate(&AccountIdentifier{}); err != nil {
		return err
	}
	if err := ACCOUNT_DB.AutoMigrate(&AccountCredential{}); err != nil {
		return err
	}
	if err := ACCOUNT_DB.AutoMigrate(&AccountProduct{}); err != nil {
		return err
	}
	if err := ACCOUNT_DB.AutoMigrate(&AccountProfile{}); err != nil {
		return err
	}
	// AutoMigrate does not reliably restore missing primary/unique constraints
	// on an already-existing PostgreSQL database (notably databases restored
	// from a data-only or incomplete schema dump). The account sync path uses
	// ON CONFLICT for these keys, so repair the indexes explicitly at startup.
	if err := ensurePostgresAccountConstraints(); err != nil {
		return err
	}
	// 添加表注释（仅 MySQL 支持）。注意：判定必须用 ACCOUNT_DB 自身的方言，
	// 而非全局 common.UsingMySQL——后者反映的是主库方言。主库 MySQL、账号中心 PG 时，
	// 用全局开关会把 MySQL 的 ALTER TABLE COMMENT 发到 PG，触发语法错误。
	if ACCOUNT_DB.Dialector.Name() == "mysql" {
		ACCOUNT_DB.Exec("ALTER TABLE `accounts` COMMENT '全局账号主表(统一账号中心唯一身份源)'")
		ACCOUNT_DB.Exec("ALTER TABLE `account_identifiers` COMMENT '账号登录标识(username/phone/wechat/email等)'")
		ACCOUNT_DB.Exec("ALTER TABLE `account_credentials` COMMENT '账号密码凭据(bcrypt)'")
		ACCOUNT_DB.Exec("ALTER TABLE `account_products` COMMENT '账号↔各产品本地用户映射'")
		ACCOUNT_DB.Exec("ALTER TABLE `account_profiles` COMMENT '账号全局档案(昵称/头像)'")
	}
	return nil
}

// ensurePostgresAccountConstraints repairs the constraints required by the
// account-center upsert paths. It is intentionally PostgreSQL-only: MySQL's
// AutoMigrate already creates these indexes and its CREATE INDEX syntax does
// not support PostgreSQL's IF NOT EXISTS form on all supported versions.
//
// A duplicate-key error is returned to the caller instead of being ignored;
// this makes a corrupt/restored database fail at startup with an actionable
// error rather than accepting users that cannot subsequently log in.
func ensurePostgresAccountConstraints() error {
	if ACCOUNT_DB == nil || ACCOUNT_DB.Dialector.Name() != "postgres" {
		return nil
	}

	statements := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS accounts_id_unique ON accounts (id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS account_identifiers_type_identifier_unique ON account_identifiers (type, identifier)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS account_credentials_account_id_unique ON account_credentials (account_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS account_products_account_product_unique ON account_products (account_id, product_code)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS account_products_product_local_unique ON account_products (product_code, local_user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_account_id_unique ON account_profiles (account_id)`,
	}
	for _, statement := range statements {
		if err := ACCOUNT_DB.Exec(statement).Error; err != nil {
			return fmt.Errorf("repair account-center constraint with %q: %w", statement, err)
		}
	}
	return nil
}

func setDBConns(db *gorm.DB) *sql.DB {
	if config.DebugSQLEnabled {
		db = db.Debug()
	}

	sqlDB, err := db.DB()
	if err != nil {
		logger.FatalLog("failed to connect database: " + err.Error())
		return nil
	}

	sqlDB.SetMaxIdleConns(env.Int("SQL_MAX_IDLE_CONNS", 100))
	sqlDB.SetMaxOpenConns(env.Int("SQL_MAX_OPEN_CONNS", 1000))
	sqlDB.SetConnMaxLifetime(time.Second * time.Duration(env.Int("SQL_MAX_LIFETIME", 60)))
	return sqlDB
}

func closeDB(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	err = sqlDB.Close()
	return err
}

func CloseDB() error {
	if LOG_DB != DB {
		err := closeDB(LOG_DB)
		if err != nil {
			return err
		}
	}
	if ACCOUNT_DB != nil && ACCOUNT_DB != DB {
		err := closeDB(ACCOUNT_DB)
		if err != nil {
			return err
		}
	}
	return closeDB(DB)
}
