package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/blacklist"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/random"
)

// getUserDB 返回用于查询用户业务数据的数据库连接。
//
// 说明：账号中心(account_center)采用规范化设计，用户信息分散在
// accounts / account_identifiers / account_credentials / account_profiles 等表，
// 并通过 account_products.local_user_id 映射到本产品(parvis)的本地 users.id。
// 因此 one-api 的用户业务数据(额度/状态/请求数等)始终存在本地 users 表，
// 账号中心仅用于统一登录认证(见 account 认证对接，TODO)。
//
// 当前实现：用户业务数据始终走本地 DB。
// ACCOUNT_DB 连接保留，供后续登录认证对接使用(查 identifiers/credentials/products)。
func getUserDB() *gorm.DB {
	return DB
}

const (
	RoleGuestUser  = 0
	RoleCommonUser = 1
	RoleAdminUser  = 10
	RoleRootUser   = 100
)

const (
	UserStatusEnabled  = 1 // don't use 0, 0 is the default value!
	UserStatusDisabled = 2 // also don't use 0
	UserStatusDeleted  = 3
)

// AccountType 决定一个账号的资产归属与计费路径,personal/enterprise 严格互斥.
//   - personal: 拥有 user_timed_quotas/subscriptions 等个人资产,走个人计费链路
//   - enterprise: 不持有任何个人积分,所有计费走 organizations 维度
const (
	AccountTypePersonal   = 1
	AccountTypeEnterprise = 2
)

// User if you add sensitive fields, don't forget to clean them in setupLogin function.
// Otherwise, the sensitive information will be saved on local storage in plain text!
type User struct {
	Id               int    `json:"id"`
	Username         string `json:"username" gorm:"unique;index;comment:用户名(双写账号中心 username 标识)" validate:"max=12"`
	Password         string `json:"password" gorm:"default:'';comment:已停写,由账号中心 account_credentials 持有(阶段 2 单源化)" validate:"min=8,max=20"`
	DisplayName      string `json:"display_name" gorm:"index;comment:昵称(播种账号中心 profile)" validate:"max=20"`
	Role             int    `json:"role" gorm:"type:int;default:1;comment:角色 1普通 10管理员 100超管"`
	Status           int    `json:"status" gorm:"type:int;default:1;comment:状态 1启用 2禁用 3注销"`
	Email            string `json:"email" gorm:"index;comment:邮箱(双写账号中心 email 标识,追记型)" validate:"max=50"`
	Phone            string `json:"phone" gorm:"index;comment:手机号(双写账号中心 phone 标识,受管型)" validate:"omitempty,max=20"`
	PhoneVerified    bool   `json:"phone_verified" gorm:"default:false;comment:手机号是否已验证"`
	GitHubId         string `json:"github_id" gorm:"column:github_id;index;comment:GitHub标识(双写账号中心,追记型)"`
	WeChatId         string `json:"wechat_id" gorm:"column:wechat_id;index;comment:微信标识(双写账号中心 wechat,受管型)"`
	LarkId           string `json:"lark_id" gorm:"column:lark_id;index;comment:飞书标识(双写账号中心,追记型)"`
	OidcId           string `json:"oidc_id" gorm:"column:oidc_id;index;comment:OIDC标识(双写账号中心,追记型)"`
	VerificationCode string `json:"verification_code" gorm:"-:all"`                                    // this field is only for Email verification, don't save it to database!
	AdminPassword    string `json:"admin_password" gorm:"-:all"`                                       // only used for admin-side sensitive operations
	AccessToken      string `json:"access_token" gorm:"type:char(32);column:access_token;uniqueIndex"` // this token is for system management
	// Quota 为兼容旧调用保留;v1 过渡期内继续维护,真实余额 = SubscriptionQuota + TimedQuotaTotal
	Quota             int64     `json:"quota" gorm:"bigint;default:0"`
	SubscriptionQuota int64     `json:"subscription_quota" gorm:"type:bigint;default:0;column:subscription_quota;comment:订阅积分(VIP或每月免费,周期清零)"`
	TimedQuotaTotal   int64     `json:"timed_quota_total" gorm:"type:bigint;default:0;column:timed_quota_total;comment:定时积分总和(冗余,等于未过期账本之和)"`
	UsedQuota         int64     `json:"used_quota" gorm:"bigint;default:0;column:used_quota"` // used quota
	RequestCount      int       `json:"request_count" gorm:"type:int;default:0;"`             // request number
	Group             string    `json:"group" gorm:"type:varchar(32);default:'default'"`
	AffCode           string    `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	InviterId         int       `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	CreatedAt         time.Time `json:"created_at" gorm:"autoCreateTime"`
	// LastFreeQuotaAt 记录上次发放"每月免费额度"的时间;NULL 表示从未发放
	LastFreeQuotaAt *time.Time `json:"last_free_quota_at" gorm:"column:last_free_quota_at;index"`
	// AccountType 决定身份与计费路径(1=个体 2=企业);企业账号不持有个人积分.
	// 切换由平台管理员发起,触发 user_timed_quotas 清零 + active subscriptions 取消 + 审计.
	AccountType int `json:"account_type" gorm:"type:int;default:1;index;comment:1=个体 2=企业,二者互斥"`
	// OrgId 企业账号所属企业ID;个体账号恒为 0
	OrgId int `json:"org_id" gorm:"type:int;default:0;index;comment:account_type=2 时必填,>0"`
	// AccountId 关联账号中心 accounts.id(雪花值);NULL 表示尚未迁移到统一账号中心.
	// 用指针类型让未迁移行为 NULL —— MySQL/PG 的 uniqueIndex 都允许多个 NULL 并存,
	// 既保证已迁移账号一一对应,又不会让大量未迁移行在 0 上撞唯一键.
	// json 加 ,string:雪花值超过 JS 安全整数(2^53),裸数字传到前端会丢精度,
	// 序列化为字符串规避;NULL 仍输出 null。前端展示用,后台用户 ID 统一以此为准。
	AccountId *int64 `json:"account_id,string" gorm:"column:account_id;uniqueIndex;comment:账号中心accounts.id,NULL=未迁移"`
	// LastActiveAt 最近活跃时间，每次有效请求时更新
	LastActiveAt *time.Time `json:"last_active_at" gorm:"column:last_active_at;index;comment:最近活跃时间"`
	// AdminPermissions 管理员可访问的后台功能模块，JSON 数组，超管不受此约束
	AdminPermissions string `json:"admin_permissions" gorm:"type:text;comment:管理员功能权限JSON数组"`
	// Tags 用户被打上的运营标签;非持久化字段(gorm:"-"),由 AttachTagsToUsers 按需填充用于后台展示。
	Tags []*UserTag `json:"tags,omitempty" gorm:"-:all"`
}

func GetMaxUserId() int {
	var user User
	DB.Last(&user)
	return user.Id
}

func GetAllUsers(startIdx int, num int, order string) (users []*User, err error) {
	query := getUserDB().Limit(num).Offset(startIdx).Omit("password").Where("status != ?", UserStatusDeleted)

	switch order {
	case "quota":
		// 按真实余额排序:镜像列 quota 可能与账本漂移,统一以 subscription_quota + timed_quota_total 为准
		query = query.Order("(subscription_quota + timed_quota_total) desc")
	case "used_quota":
		query = query.Order("used_quota desc")
	case "request_count":
		query = query.Order("request_count desc")
	default:
		query = query.Order("id desc")
	}

	err = query.Find(&users).Error
	if err != nil {
		return users, err
	}
	OverlayUsersIdentity(users) // 读穿账号中心:phone/email/display_name 展示以账号中心为准(阶段 3-5 单源化)
	return users, err
}

func SearchUsers(keyword string) (users []*User, err error) {
	// 阶段 7 单源化：身份字段(email/phone)单源到账号中心后,users.email/phone 仍是
	// 双写副本但不能跨库 JOIN(库可换铁律)。改两步查:
	//   1) 在账号中心 account_identifiers LIKE 拿匹配的 account_id 集合(覆盖 email/phone)
	//   2) 在 users 上 OR 拼:id=keyword OR username LIKE OR display_name LIKE OR account_id IN
	// username 与 display_name 仍按 users 列匹配(username 阶段 6 未单源化, display_name
	// 是双写副本/B 类档案在 EnsureAccountForUser 时播种,users 列与账号中心保持一致)。
	matchedAccountIDs, err := searchAccountIDsByIdentifier(keyword)
	if err != nil {
		// 账号中心查询失败不阻断搜索,降级为只按 users 匹配
		logger.SysErrorf("SearchUsers 账号中心查询失败,降级为只按 users 匹配: %v", err)
		matchedAccountIDs = nil
	}

	query := DB.Omit("password")
	like := "%" + keyword + "%"
	if !common.UsingPostgreSQL {
		if len(matchedAccountIDs) > 0 {
			query = query.Where("id = ? or username LIKE ? or email LIKE ? or display_name LIKE ? or account_id IN ?",
				keyword, like, like, like, matchedAccountIDs)
		} else {
			query = query.Where("id = ? or username LIKE ? or email LIKE ? or display_name LIKE ?",
				keyword, like, like, like)
		}
	} else {
		if len(matchedAccountIDs) > 0 {
			query = query.Where("username LIKE ? or email LIKE ? or display_name LIKE ? or account_id IN ?",
				like, like, like, matchedAccountIDs)
		} else {
			query = query.Where("username LIKE ? or email LIKE ? or display_name LIKE ?",
				like, like, like)
		}
	}
	if err = query.Find(&users).Error; err != nil {
		return users, err
	}
	// 返回结果的 phone/email/display_name 走读穿覆盖,与单条 GetUserById 行为一致。
	OverlayUsersIdentity(users)
	return users, err
}

// searchAccountIDsByIdentifier 在账号中心 account_identifiers 上按 keyword 前缀匹配
// username/email/phone,返回去重的 account_id 列表。账号中心未启用或无匹配时返回 nil。
// 阶段 6 起 username 也是受管标识(users.username 在启用时写为 acc_<ts>_<rand> 占位),
// 故按真实用户名搜索必须走账号中心,users.username LIKE 永远命中不了。
func searchAccountIDsByIdentifier(keyword string) ([]int64, error) {
	if ACCOUNT_DB == nil || keyword == "" {
		return nil, nil
	}
	var ids []int64
	if err := ACCOUNT_DB.Model(&AccountIdentifier{}).
		Where("type IN ? AND identifier LIKE ?",
			[]string{IdentifierTypeUsername, IdentifierTypeEmail, IdentifierTypePhone}, "%"+keyword+"%").
		Distinct("account_id").Pluck("account_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// searchAccountIDsByIdentifierExact 在账号中心按 identifier 精确匹配 username/email/phone,
// 返回去重的 account_id 列表。供精确操作符(=/!=/包含于)使用——与
// searchAccountIDsByIdentifier 的前缀模糊匹配不同,这里要求完全相等。
// 账号中心未启用或无匹配时返回 nil。
func searchAccountIDsByIdentifierExact(identifiers []string) ([]int64, error) {
	if ACCOUNT_DB == nil || len(identifiers) == 0 {
		return nil, nil
	}
	var ids []int64
	if err := ACCOUNT_DB.Model(&AccountIdentifier{}).
		Where("type IN ? AND identifier IN ?",
			[]string{IdentifierTypeUsername, IdentifierTypeEmail, IdentifierTypePhone}, identifiers).
		Distinct("account_id").Pluck("account_id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func GetUserById(id int, selectAll bool) (*User, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	user := User{Id: id}
	var err error = nil

	if selectAll {
		err = getUserDB().First(&user, "id = ?", id).Error
	} else {
		err = getUserDB().Omit("password", "access_token").First(&user, "id = ?", id).Error
	}
	if err == nil {
		// 阶段 3-4 单源化：覆盖 phone / email / display_name 为账号中心权威值。
		// 所有 controller 业务流读 user.Phone 等字段都会自动拿到最新值,无需逐个加 overlay。
		OverlayUsersIdentity([]*User{&user})
	}
	return &user, err
}

func GetUserByUsername(username string) (*User, error) {
	if username == "" {
		return nil, errors.New("username 为空")
	}
	// 阶段 6 单源化:users.username 启用账号中心时写为 acc_<ts>_<rand> 占位,
	// 真实 username 在 account_identifiers。先走 FillUserByUsername 路径(它内部
	// 优先查账号中心,未启用时回退查 users)。
	user := User{Username: username}
	if err := user.FillUserByUsername(); err != nil {
		return &user, err
	}
	if user.Id == 0 {
		return &user, gorm.ErrRecordNotFound
	}
	OverlayUsersIdentity([]*User{&user})
	return &user, nil
}

func GetUserIdByAffCode(affCode string) (int, error) {
	if affCode == "" {
		return 0, errors.New("affCode 为空！")
	}
	var user User

	err := getUserDB().Select("id").First(&user, "aff_code = ?", affCode).Error
	return user.Id, err
}

func DeleteUserById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	user := User{Id: id}
	return user.Delete()
}

func (user *User) Insert(ctx context.Context, inviterId int) error {
	// 阶段 2 单源化：密码改为只写账号中心 account_credentials。Insert 时把明文暂存，
	// users.password 列停写（落空串），落库 + 投影完成后由 EnsureAccountForUser 写入
	// credential。这样 users.password 永远为空字符串，登录强制走 authByAccountCenter。
	// 注意：不能用 Omit("password") —— 老库 users.password 是历史遗留的 NOT NULL 无默认值列,
	// Omit 会让 INSERT 缺这一列,MySQL strict mode 直接报 1364(Field 'password' doesn't
	// have a default value)。这里显式置空串,既满足 NOT NULL 约束,也保留单源化语义。
	pendingPassword := user.Password
	user.Password = ""
	// 新用户首次注册:余额字段全部从 0 起,首月免费额度在用户创建成功后走积分账本发放(见下方);
	// 同时记录免费额度发放时间为现在,30 天后的 0 点起方可再次发放
	user.SubscriptionQuota = 0
	user.TimedQuotaTotal = 0
	user.Quota = 0
	user.AccessToken = random.GetUUID()
	user.AffCode = random.GetRandomString(4)
	now := time.Now()
	user.LastFreeQuotaAt = &now
	// 单源化：display_name 由账号中心 account_profiles 持有，users.display_name 列停写。
	// Insert 时把 user 内存里的 DisplayName 暂存，落库时 Omit；落库 + 投影完成后再写
	// 档案。这样 users.display_name 永远为空字符串，对所有读路径不可见——读穿/列表
	// overlay 都从账号中心取，避免「Insert 时落 users 旧值、之后改名时不一致」的漂移。
	pendingDisplayName := user.DisplayName
	user.DisplayName = ""

	// 阶段 4-6 单源化：账号中心启用后,所有身份字段(username/email/phone/wechat_id/...)
	// 由账号中心 account_identifiers 持有,users 旧列停写。把内存值暂存,落库 Omit,
	// 落库后 EnsureAccountForUser 会从 user 的内存字段(未被 Omit 改动)写入账号中心,
	// 然后我们把内存值还原回 user 供调用方继续使用(SetupLogin/cleanUser)。
	// username 有唯一索引,空字符串会撞键,故用雪花占位写入 users.username。
	pendingUsername, pendingEmail, pendingPhone, pendingPhoneVerified := user.Username, user.Email, user.Phone, user.PhoneVerified
	pendingWeChat, pendingGitHub, pendingLark, pendingOidc := user.WeChatId, user.GitHubId, user.LarkId, user.OidcId
	omitColumns := []string{"display_name"}
	if ACCOUNT_DB != nil {
		// 阶段 6：username 由账号中心持有,users.username 落雪花占位避免唯一键撞键,
		// 同时让所有 fallback 直查 users 的旧路径找不到该占位,强制走账号中心。
		user.Username = fmt.Sprintf("acc_%d", helper.GetTimestamp()) + "_" + random.GetRandomString(6)
		user.Email = ""
		user.Phone = ""
		user.PhoneVerified = false
		user.WeChatId = ""
		user.GitHubId = ""
		user.LarkId = ""
		user.OidcId = ""
		omitColumns = append(omitColumns,
			"email", "phone", "phone_verified",
			"wechat_id", "github_id", "lark_id", "oidc_id")
	}
	result := DB.Omit(omitColumns...).Create(user)
	if result.Error != nil {
		// 落库失败要把内存还原,不污染调用方
		user.Username, user.Email, user.Phone, user.PhoneVerified = pendingUsername, pendingEmail, pendingPhone, pendingPhoneVerified
		user.WeChatId, user.GitHubId, user.LarkId, user.OidcId = pendingWeChat, pendingGitHub, pendingLark, pendingOidc
		return result.Error
	}
	// 还原内存身份字段,EnsureAccountForUser / SetupLogin 都需要这些值。
	if ACCOUNT_DB != nil {
		user.Username, user.Email, user.Phone, user.PhoneVerified = pendingUsername, pendingEmail, pendingPhone, pendingPhoneVerified
		user.WeChatId, user.GitHubId, user.LarkId, user.OidcId = pendingWeChat, pendingGitHub, pendingLark, pendingOidc
	}
	// 注册赠送积分已统一改由「活动配置」(trigger_type=register)发放,见下方 TriggerActivities。
	// 原 QuotaForNewUser option 已下线。

	// ✨ 触发注册活动
	if err := TriggerActivities(ctx, "register", user.Id); err != nil {
		logger.SysError(fmt.Sprintf("触发注册活动失败 user=%d: %v", user.Id, err))
		// 埋点上报
		// telemetry.track("注册活动异常", map[string]interface{}{"user_id": user.Id, "error": err.Error()})
	}

	if freeQuota := GetTrialFreeQuota(); freeQuota > 0 {
		// 首月免费额度走 monthly_free 账本笔(带 30 天过期),与每月免费 cron 完全一致:
		// 既插入 user_timed_quota 行(供扣费/过期/对账),又同步累加 subscription_quota。
		// 额度取自「试用包」(个人套餐中 price=0 且启用的套餐),见 GetTrialFreeQuota。
		ttl := FreeQuotaIntervalDays * 24 * time.Hour
		if err := AddUserTimedQuota(user.Id, freeQuota, TimedQuotaSourceMonthlyFree, "monthly_free", &ttl); err != nil {
			logger.SysError(fmt.Sprintf("发放首月免费额度失败 user=%d: %v", user.Id, err))
		}
		RecordLog(ctx, user.Id, LogTypeSystem, fmt.Sprintf("首次免费额度赠送 %s", common.LogQuota(freeQuota)))
	}
	if inviterId != 0 {
		if config.QuotaForInvitee > 0 {
			_ = AddUserTimedQuota(user.Id, config.QuotaForInvitee, TimedQuotaSourceInvite, "", nil)
			RecordLog(ctx, user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", common.LogQuota(config.QuotaForInvitee)))
		}
		// 邀请人若已是企业账户,跳过赠送(企业账户不持有个人积分)
		if config.QuotaForInviter > 0 {
			var inviter User
			if err := DB.Select("id", "account_type").Where("id = ?", inviterId).First(&inviter).Error; err == nil && inviter.AccountType == AccountTypePersonal {
				_ = AddUserTimedQuota(inviterId, config.QuotaForInviter, TimedQuotaSourceInvite, "", nil)
				RecordLog(ctx, inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", common.LogQuota(config.QuotaForInviter)))
			}
		}
	}
	// create default token
	cleanToken := Token{
		UserId:         user.Id,
		Name:           "default",
		Key:            random.GenerateKey(),
		CreatedTime:    helper.GetTimestamp(),
		AccessedTime:   helper.GetTimestamp(),
		ExpiredTime:    -1,
		RemainQuota:    -1,
		UnlimitedQuota: true,
	}
	result.Error = cleanToken.Insert()
	if result.Error != nil {
		// do not block
		logger.SysError(fmt.Sprintf("create default token for user %d failed: %s", user.Id, result.Error.Error()))
	}
	// 阶段 A 双写：注册成功后把用户投影到账号中心（失败不阻断）。
	// 临时把 hash 后的密码放回 user.Password，让 EnsureAccountForUser 写入
	// account_credentials；投影后立刻清空，避免对调用方泄露。
	if pendingPassword != "" {
		hashed, hashErr := common.Password2Hash(pendingPassword)
		if hashErr != nil {
			logger.SysError(fmt.Sprintf("hash password failed for user %d: %v", user.Id, hashErr))
		} else {
			user.Password = hashed
		}
	}
	SyncAccountForUser(user, "register")
	user.Password = ""
	// 阶段 1 单源化：把 display_name 写到账号中心档案（B 类，唯一权威写入源）。
	// 必须在 SyncAccountForUser 之后——前者会建好 account 与映射，否则 profile
	// 写入找不到 account_id。失败不阻断（注册主流程已成功，profile 是展示信息）。
	if pendingDisplayName != "" {
		SyncAccountProfileByUserID(user.Id, pendingDisplayName, "", "register")
		// 把 display_name 还原回内存对象，调用方（OAuth 控制器、SetupLogin）仍能读到，
		// 不影响 cleanUser 等返回值。读穿基础设施会让后续请求自动从账号中心拿。
		user.DisplayName = pendingDisplayName
	}
	return nil
}

func (user *User) Update(updatePassword bool) error {
	// 阶段 2 单源化：密码改为只写账号中心 account_credentials。
	// updatePassword=true 时把明文密码暂存，落库前 Omit("password") 让 users 列停写，
	// 落库后单独调 WriteAccountCredentialByLocalUser 写入账号中心。
	pendingPassword := ""
	if updatePassword {
		pendingPassword = user.Password
		user.Password = ""
	}
	if user.Status == UserStatusDisabled {
		blacklist.BanUser(user.Id)
	} else if user.Status == UserStatusEnabled {
		blacklist.UnbanUser(user.Id)
	}
	// Omit 业务字段（积分、配额）+ B 类档案（display_name）+ 阶段 2 password
	// + 阶段 3 email + 阶段 4 phone/phone_verified
	// + 阶段 5 wechat_id/github_id/lark_id/oidc_id + 阶段 6 username。
	// 这些字段都已是「账号中心唯一权威写入源」,users 列停写,
	// 避免 User.Update 用部分字段结构体把账号中心权威值反向回冲。
	err := DB.Model(user).
		Omit("quota", "subscription_quota", "timed_quota_total",
			"display_name", "password",
			"email",
			"phone", "phone_verified",
			"username",
			"wechat_id", "github_id", "lark_id", "oidc_id").
		Updates(user).Error
	if err != nil {
		return err
	}
	if pendingPassword != "" {
		if err := WriteAccountCredentialByLocalUser(user.Id, pendingPassword); err != nil {
			logger.SysErrorf("账号中心改密失败(user_update, user=%d): %v", user.Id, err)
		}
	}
	// 阶段 A 双写：用户身份字段（手机/微信等）变更后同步到账号中心。
	// 用 by-ID 重载，避免 user 是部分字段结构体导致投影污染（失败不阻断）。
	SyncAccountByUserID(user.Id, "user_update")
	return nil
}

func (user *User) Delete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	blacklist.BanUser(user.Id)
	user.Username = fmt.Sprintf("deleted_%s", random.GetUUID())
	user.Status = UserStatusDeleted
	if err := DB.Model(user).Updates(user).Error; err != nil {
		return err
	}
	// 注销后清理账号中心受管 identifier，并把 accounts.status 标为 Deleted。
	// 若不清，旧用户的 username/phone/wechat 标识会以 uk_type_identifier 永久占位，
	// 同号再注册会因撞键被 DoNothing 跳过、新账号缺标识。失败不阻断（副本错误不该卡注销）。
	DetachAccountForLocalUser(user.Id, "user_delete")
	return nil
}

// HardDelete 物理删除用户及其全部关联数据（仅供后台清理测试账号）。
//
// 与 Delete() 的软删（仅改 status=3 + 改名 + 拉黑）不同：这里真正 DELETE 行，
// 删完后该用户在业务库 / 日志库 / 账号中心的痕迹全部清空，手机号释放，可同号重注册。
//
// 事务边界：
//   - 业务库（DB）：所有按 user_id 关联的表 + users 本行，单事务包裹，任一失败整体回滚。
//   - 日志库（LOG_DB）：可能是独立实例，跨库无法同事务，单独删（失败不阻断，仅记日志）。
//   - 账号中心（ACCOUNT_DB）：副本性质，单独事务清理（失败不阻断，仅记日志）。
//
// 不可逆操作，调用方须自行做好权限校验与二次确认。
func (user *User) HardDelete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	uid := user.Id
	// 物理删除后该用户不复存在，无需保留黑名单占位，先解除避免残留。
	blacklist.UnbanUser(uid)

	// 业务库：按 user_id 逐表物理删除，最后删 users 本行，单事务保证一致性。
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 逐表删除：每条 Where 都新建查询，避免链式条件累积。
		for _, m := range []interface{}{
			&Token{}, &Redemption{}, &Subscription{}, &Order{}, &UserTimedQuota{},
			&UserCoupon{}, &Invoice{}, &RechargeRecord{}, &ActivityParticipation{},
			&UserTagRelation{}, &ClientEvent{}, &AccountTypeChange{},
			&OrgMember{}, &OrgMemberLimit{}, &CustomDashboardChart{}, &OperationDashboard{},
		} {
			if err := tx.Where("user_id = ?", uid).Delete(m).Error; err != nil {
				return err
			}
		}
		// 邀请记录：该用户既可能是邀请人也可能是被邀请人，两个键都要清。
		if err := tx.Where("inviter_id = ? OR invitee_id = ?", uid, uid).
			Delete(&InviteRecord{}).Error; err != nil {
			return err
		}
		// 最后物理删除 users 本行（注意：User 无软删字段，这是真正的 DELETE）。
		if err := tx.Where("id = ?", uid).Delete(&User{}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}

	// 日志库可能是独立实例，跨库无法并入上面的事务，单独删。失败不阻断（日志非关键）。
	if delErr := LOG_DB.Where("user_id = ?", uid).Delete(&Log{}).Error; delErr != nil {
		logger.SysErrorf("硬删除清理日志失败(user=%d): %v", uid, delErr)
	}

	// 账号中心是副本，单独清理（失败不阻断，仅记日志）。
	hardDetachAccountForLocalUser(uid, "hard_delete")
	return nil
}

// ValidateAndFill check password & user status
func (user *User) ValidateAndFill() (err error) {
	// When querying with struct, GORM will only query with non-zero fields,
	// that means if your field's value is 0, '', false or other zero values,
	// it won't be used to build query conditions
	password := user.Password
	if user.Username == "" || password == "" {
		return errors.New("用户名或密码为空")
	}
	// 阶段 C：先走账号中心。命中并通过 → 用账号中心解析出的本地 user 覆盖填充；
	// 账号中心无法处理（未启用/未迁移/无映射）→ ok=false，回退下方老路；
	// 命中但密码错/被禁 → 直接返回 err，不回退。
	if acUser, ok, acErr := authByAccountCenter(user.Username, password); acErr != nil {
		return acErr
	} else if ok {
		*user = *acUser
		return nil
	}
	// 阶段 2 单源化：账号中心启用后，密码已是「账号中心唯一权威写入源」，users.password
	// 列停写。若账号中心已启用却走到这里，说明该 username/phone/email 在账号中心查不到——
	// 既然密码不再写 users，老路 users.password 必然是空字符串，绝不可能匹配，回退也注定失败。
	// 直接返回认证错误，避免误导式「找到用户但密码错」分支。
	if ACCOUNT_DB != nil {
		return errors.New("用户名或密码错误，或用户已被封禁")
	}
	// 灰度未启用时保留老路：直接查 users（含 username/email/phone 三种登录入口归一）。
	err = DB.Where("username = ?", user.Username).First(user).Error
	if err != nil {
		err = DB.Where("email = ?", user.Username).First(user).Error
		if err != nil {
			phone := user.Username
			if !strings.HasPrefix(phone, "+") {
				if strings.HasPrefix(phone, "86") && len(phone) >= 13 {
					phone = "+" + phone
				} else if len(phone) == 11 && phone[0] == '1' {
					phone = "+86" + phone
				}
			}
			err = getUserDB().Where("phone = ?", phone).First(user).Error
			if err != nil {
				return errors.New("用户名或密码错误，或用户已被封禁")
			}
		}
	}
	okay := common.ValidatePasswordAndHash(password, user.Password)
	if !okay || user.Status != UserStatusEnabled {
		return errors.New("用户名或密码错误，或用户已被封禁")
	}
	return nil
}

func (user *User) FillUserById() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	DB.Where(User{Id: user.Id}).First(user)
	// 阶段 3-4 单源化：覆盖 phone / email / display_name 为账号中心权威值。
	OverlayUsersIdentity([]*User{user})
	return nil
}

func (user *User) FillUserByEmail() error {
	if user.Email == "" {
		return errors.New("email 为空！")
	}
	// 阶段 3 单源化：先查账号中心 identifier 拿 account_id,再查 account_products
	// 反查本地 user(库可换铁律下不能跨库 JOIN)。账号中心未启用回退老路直查 users。
	if ACCOUNT_DB != nil {
		if u, ok := fillUserByAccountIdentifier(IdentifierTypeEmail, user.Email); ok {
			*user = *u
			return nil
		}
	}
	DB.Where(User{Email: user.Email}).First(user)
	return nil
}

// fillUserByAccountIdentifier 阶段 3 起的通用「按账号中心标识反查本地 user」实现。
// identifier 命中→拿 account_id→拿 parvis 映射→拿 users。任何一步失败/缺失返回 (nil, false)。
func fillUserByAccountIdentifier(typ, identifier string) (*User, bool) {
	var ident AccountIdentifier
	if err := ACCOUNT_DB.Where("type = ? AND identifier = ?", typ, identifier).
		First(&ident).Error; err != nil {
		return nil, false
	}
	var ap AccountProduct
	if err := ACCOUNT_DB.Where("account_id = ? AND product_code = ?", ident.AccountId, ProductCodeParvis).
		First(&ap).Error; err != nil {
		return nil, false
	}
	var u User
	if err := DB.First(&u, "id = ?", ap.LocalUserId).Error; err != nil {
		return nil, false
	}
	return &u, true
}

func (user *User) FillUserByGitHubId() error {
	if user.GitHubId == "" {
		return errors.New("GitHub id 为空！")
	}
	if ACCOUNT_DB != nil {
		if u, ok := fillUserByAccountIdentifier(IdentifierTypeGitHub, user.GitHubId); ok {
			*user = *u
			return nil
		}
	}
	DB.Where(User{GitHubId: user.GitHubId}).First(user)
	return nil
}

func (user *User) FillUserByLarkId() error {
	if user.LarkId == "" {
		return errors.New("lark id 为空！")
	}
	if ACCOUNT_DB != nil {
		if u, ok := fillUserByAccountIdentifier(IdentifierTypeLark, user.LarkId); ok {
			*user = *u
			return nil
		}
	}
	DB.Where(User{LarkId: user.LarkId}).First(user)
	return nil
}

func (user *User) FillUserByOidcId() error {
	if user.OidcId == "" {
		return errors.New("oidc id 为空！")
	}
	if ACCOUNT_DB != nil {
		if u, ok := fillUserByAccountIdentifier(IdentifierTypeOidc, user.OidcId); ok {
			*user = *u
			return nil
		}
	}
	DB.Where(User{OidcId: user.OidcId}).First(user)
	return nil
}

func (user *User) FillUserByWeChatId() error {
	if user.WeChatId == "" {
		return errors.New("WeChat id 为空！")
	}
	if ACCOUNT_DB != nil {
		if u, ok := fillUserByAccountIdentifier(IdentifierTypeWeChat, user.WeChatId); ok {
			*user = *u
			return nil
		}
	}
	DB.Where(User{WeChatId: user.WeChatId}).First(user)
	return nil
}

func (user *User) FillUserByUsername() error {
	if user.Username == "" {
		return errors.New("username 为空！")
	}
	// 阶段 6 单源化：username 是受管标识,以账号中心为权威。
	if ACCOUNT_DB != nil {
		if u, ok := fillUserByAccountIdentifier(IdentifierTypeUsername, user.Username); ok {
			*user = *u
			return nil
		}
	}
	DB.Where(User{Username: user.Username}).First(user)
	return nil
}

func IsEmailAlreadyTaken(email string) bool {
	// 阶段 3 单源化：email 是受管标识,以账号中心为权威。
	// 账号中心未启用时回退查 users.email,保证灰度期间行为一致。
	if ACCOUNT_DB != nil {
		var n int64
		ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", IdentifierTypeEmail, email).Count(&n)
		return n > 0
	}
	return DB.Where("email = ?", email).Find(&User{}).RowsAffected == 1
}

func IsWeChatIdAlreadyTaken(wechatId string) bool {
	if ACCOUNT_DB != nil {
		var n int64
		ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", IdentifierTypeWeChat, wechatId).Count(&n)
		return n > 0
	}
	return DB.Where("wechat_id = ?", wechatId).Find(&User{}).RowsAffected == 1
}

func IsGitHubIdAlreadyTaken(githubId string) bool {
	if ACCOUNT_DB != nil {
		var n int64
		ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", IdentifierTypeGitHub, githubId).Count(&n)
		return n > 0
	}
	return DB.Where("github_id = ?", githubId).Find(&User{}).RowsAffected == 1
}

func IsLarkIdAlreadyTaken(githubId string) bool {
	if ACCOUNT_DB != nil {
		var n int64
		ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", IdentifierTypeLark, githubId).Count(&n)
		return n > 0
	}
	return DB.Where("lark_id = ?", githubId).Find(&User{}).RowsAffected == 1
}

func IsOidcIdAlreadyTaken(oidcId string) bool {
	if ACCOUNT_DB != nil {
		var n int64
		ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", IdentifierTypeOidc, oidcId).Count(&n)
		return n > 0
	}
	return DB.Where("oidc_id = ?", oidcId).Find(&User{}).RowsAffected == 1
}

func IsUsernameAlreadyTaken(username string) bool {
	// 阶段 6 单源化：username 是受管标识,以账号中心为权威。
	if ACCOUNT_DB != nil {
		var n int64
		ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", IdentifierTypeUsername, username).Count(&n)
		return n > 0
	}
	return DB.Where("username = ?", username).Find(&User{}).RowsAffected == 1
}

func ResetUserPasswordByEmail(email string, password string) error {
	if email == "" || password == "" {
		return errors.New("邮箱地址或密码为空！")
	}
	// 阶段 2 单源化：密码改为只写账号中心。按 email 反查（账号中心 email 是受管类型，
	// 阶段 3 起先删后建保证 1 行/账号），命中即调 WriteAccountCredentialByLocalUser。
	// 兼容历史多账号同 email 场景：仍按 users.email LIKE 全量同步（与老逻辑等价）。
	var ids []int
	if e := DB.Model(&User{}).Where("email = ?", email).Pluck("id", &ids).Error; e == nil {
		for _, id := range ids {
			if err := WriteAccountCredentialByLocalUser(id, password); err != nil {
				logger.SysErrorf("账号中心改密失败(reset_password_by_email, user=%d): %v", id, err)
			}
		}
	}
	if ACCOUNT_DB != nil {
		// 账号中心已启用 → users.password 已交由 WriteAccountCredentialByLocalUser
		// （未投影时也回退写 users），无需再写一次。
		return nil
	}
	// 灰度未启用：保留老路径直写 users.password。
	hashedPassword, err := common.Password2Hash(password)
	if err != nil {
		return err
	}
	return DB.Model(&User{}).Where("email = ?", email).Update("password", hashedPassword).Error
}

func IsAdmin(userId int) bool {
	if userId == 0 {
		return false
	}
	var user User
	err := DB.Where("id = ?", userId).Select("role").Find(&user).Error
	if err != nil {
		logger.SysError("no such user " + err.Error())
		return false
	}
	return user.Role >= RoleAdminUser
}

func IsUserEnabled(userId int) (bool, error) {
	if userId == 0 {
		return false, errors.New("user id is empty")
	}
	var user User
	err := DB.Where("id = ?", userId).Select("status").Find(&user).Error
	if err != nil {
		return false, err
	}
	return user.Status == UserStatusEnabled, nil
}

func ValidateAccessToken(token string) (user *User) {
	if token == "" {
		return nil
	}
	token = strings.Replace(token, "Bearer ", "", 1)
	user = &User{}

	if getUserDB().Where("access_token = ?", token).First(user).RowsAffected == 1 {
		return user
	}
	return nil
}

// GetUserQuota 返回总余额 = subscription_quota + timed_quota_total.
// 单行读,无 join.quota 列只作为 v1 兼容字段,在所有写入路径同步维护一致,
// 但读取以新两字段之和为准,避免不同写路径维护不到位时偏差.
func GetUserQuota(id int) (quota int64, err error) {
	var u struct {
		SubscriptionQuota int64
		TimedQuotaTotal   int64
	}

	err = getUserDB().Model(&User{}).Where("id = ?", id).
		Select("subscription_quota, timed_quota_total").Take(&u).Error
	if err != nil {
		return 0, err
	}
	return u.SubscriptionQuota + u.TimedQuotaTotal, nil
}

func GetUserUsedQuota(id int) (quota int64, err error) {
	err = getUserDB().Model(&User{}).Where("id = ?", id).Select("used_quota").Find(&quota).Error
	return quota, err
}

func GetUserEmail(id int) (email string, err error) {
	// 阶段 3 单源化：email 已是受管类型(account_identifiers 镜像 users 当前值、单行),
	// 优先读账号中心,出错或缺失回退 users.email 兜底(双写期保护)。
	var u struct {
		Email string
	}
	err = DB.Model(&User{}).Where("id = ?", id).
		Select("email").Take(&u).Error
	if err != nil {
		return "", err
	}
	return ResolveUserIdentifierByLocalUser(id, IdentifierTypeEmail, u.Email), nil
}

func GetUserGroup(id int) (group string, err error) {
	groupCol := quoteSQLIdentifier("group")
	err = getUserDB().Model(&User{}).Where("id = ?", id).Select(groupCol).Find(&group).Error
	return group, err
}

// IncreaseUserQuota 兼容旧外部调用,统一收敛为发放一笔永久定时积分(source=admin).
// 历史路径:邀请奖励 / 退款回滚 / batch update 反向回填.外部插件如果直接调用本函数,
// 也会自动落到新账本.内部新代码请直接走 AddUserTimedQuota / IncreaseUserSubscriptionQuota.
func IncreaseUserQuota(id int, quota int64) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return nil
	}
	if config.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuota, id, quota)
		return nil
	}
	return increaseUserQuota(id, quota)
}

// increaseUserQuota 内部函数:把 quota 当作"新增永久定时积分"发放.
//   - 严格要求 quota >= 0;负值场景(消费回滚)由调用方走 decreaseUserQuota / AddUserTimedQuota refund
//   - batch update 路径已在 utils.go 拆分正负方向,确保不会传入负值
func increaseUserQuota(id int, quota int64) (err error) {
	if quota < 0 {
		return errors.New("increaseUserQuota: quota 不能为负数,负值方向请走 decreaseUserQuota")
	}
	if quota == 0 {
		return nil
	}
	return AddUserTimedQuota(id, quota, TimedQuotaSourceAdmin, "", nil)
}

// SetUserSubscriptionQuota 覆盖式写入订阅积分(PR2 起 VIP 续期使用).
// 同步维护 quota 列以保证旧读取路径正确.
func SetUserSubscriptionQuota(id int, quota int64, sourceRef string, expiresAt *time.Time) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var u User
		if err := tx.Select("subscription_quota", "timed_quota_total").
			Where("id = ?", id).First(&u).Error; err != nil {
			return err
		}
		if u.SubscriptionQuota > 0 {
			if err := tx.Model(&UserTimedQuota{}).
				Where("user_id = ? AND remaining > 0 AND source IN ?", id, subscriptionQuotaSources()).
				Update("remaining", 0).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{
			"subscription_quota": 0,
			"quota":              u.TimedQuotaTotal,
		}).Error; err != nil {
			return err
		}
		if quota == 0 {
			return nil
		}
		return addUserQuotaLedgerTx(tx, id, quota, TimedQuotaSourceSubscription, sourceRef, expiresAt)
	})
}

// SubscriptionQuotaGrant 描述一次续期里某个订阅块的发放计划:积分额 + 真实订单号 + 到期时间.
type SubscriptionQuotaGrant struct {
	Quota     int64
	OrderNo   string
	ExpiresAt *time.Time
}

// AddSubscriptionQuotaPerOrder 按订阅块逐笔追加订阅积分,不清零任何已有余额(T1-3 队列模型续期/恢复使用)。
// 与 SetUserSubscriptionQuotaPerOrder 的区别:本函数只增不删,保留各笔积分按自身 order_no 与到期日存活,
// 实现"钱包叠加、各自到期"(见规则文档 2.1 / 行为 5)。每笔 source_ref 写真实 order_no 以支撑按订单退款。
func AddSubscriptionQuotaPerOrder(id int, grants []SubscriptionQuotaGrant) error {
	for _, g := range grants {
		if g.Quota < 0 {
			return errors.New("quota 不能为负数！")
		}
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		for _, g := range grants {
			if g.Quota <= 0 {
				continue
			}
			if err := addUserQuotaLedgerTx(tx, id, g.Quota, TimedQuotaSourceSubscription, g.OrderNo, g.ExpiresAt); err != nil {
				return err
			}
		}
		return nil
	})
}

// IncreaseUserSubscriptionQuota 累加订阅积分(VIP 首购 / 同周期升级叠加).
func IncreaseUserSubscriptionQuota(id int, quota int64, sourceRef string, expiresAt *time.Time) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return addUserQuotaLedgerTx(tx, id, quota, TimedQuotaSourceSubscription, sourceRef, expiresAt)
	})
}

// IncreaseUserSubscriptionQuotaTx 同 IncreaseUserSubscriptionQuota,但接受外部事务句柄,
// 供首购流程把 subscription / quota / recharge_record 三步串行落库.
func IncreaseUserSubscriptionQuotaTx(tx *gorm.DB, id int, quota int64, sourceRef string, expiresAt *time.Time) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return nil
	}
	return addUserQuotaLedgerTx(tx, id, quota, TimedQuotaSourceSubscription, sourceRef, expiresAt)
}

// SetUserTotalQuota 用于管理员"直接设置总余额"场景.
// 增加部分落一笔永久 admin 定时积分;减少部分按正常扣费顺序扣减账本与订阅积分.
func SetUserTotalQuota(id int, quota int64, sourceRef string) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var u User
		query := tx.Select("id", "subscription_quota", "timed_quota_total").Where("id = ?", id)
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&u).Error; err != nil {
			return err
		}
		current := u.SubscriptionQuota + u.TimedQuotaTotal
		switch {
		case quota == current:
			return nil
		case quota > current:
			return addUserTimedQuotaTx(tx, id, quota-current, TimedQuotaSourceAdmin, sourceRef, nil)
		default:
			return decreaseUserQuotaTx(tx, id, current-quota)
		}
	})
}

// DecreaseUserQuota 扣费.事务内按积分账本有效期从短到长扣减:
//  1. 有到期时间的积分按 expires_at 升序消耗
//  2. 永久积分(expires_at IS NULL)排在最后
//  3. 全程同步维护 users.quota 镜像列(总余额),保证旧排序/旧读取仍正确
//
// 高并发同用户消费经 SELECT FOR UPDATE 串行化;Redis 预扣闸门挡在前面,落账串行可控.
func DecreaseUserQuota(id int, quota int64) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return nil
	}
	if config.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuotaDecrease, id, quota)
		return nil
	}
	return decreaseUserQuota(id, quota)
}

func decreaseUserQuota(id int, quota int64) (err error) {
	if quota <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return decreaseUserQuotaTx(tx, id, quota)
	})
}

func decreaseUserQuotaTx(tx *gorm.DB, id int, quota int64) error {
	if quota <= 0 {
		return nil
	}
	var user User
	userQuery := tx.Select("id", "subscription_quota", "timed_quota_total").Where("id = ?", id)
	if !common.UsingSQLite {
		userQuery = userQuery.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := userQuery.First(&user).Error; err != nil {
		return err
	}

	var rows []UserTimedQuota
	// CASE 表达式让永久积分(NULL)排在所有有限期之后,统一兼容 MySQL/PostgreSQL/SQLite
	nowSql := "NOW()"
	if common.UsingSQLite {
		nowSql = "CURRENT_TIMESTAMP"
	}
	query := tx.
		Where("user_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > "+nowSql+")", id).
		Order("CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC")
	if !common.UsingSQLite {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Find(&rows).Error; err != nil {
		return err
	}

	remain := quota
	var deductedTimed int64
	var deductedSubscription int64
	for _, row := range rows {
		if remain == 0 {
			break
		}
		take := row.Remaining
		if take > remain {
			take = remain
		}
		res := tx.Model(&UserTimedQuota{}).Where("id = ? AND remaining >= ?", row.Id, take).
			Update("remaining", gorm.Expr("remaining - ?", take))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errors.New("积分账本并发扣减冲突")
		}
		if isSubscriptionQuotaSource(row.Source) {
			deductedSubscription += take
		} else {
			deductedTimed += take
		}
		remain -= take
	}

	if deductedTimed > 0 {
		if err := tx.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{
			"timed_quota_total": greatestZeroExpr("timed_quota_total", deductedTimed),
			"quota":             greatestZeroExpr("quota", deductedTimed),
		}).Error; err != nil {
			return err
		}
	}

	if deductedSubscription > 0 {
		res := tx.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{
			"subscription_quota": greatestZeroExpr("subscription_quota", deductedSubscription),
			"quota":              greatestZeroExpr("quota", deductedSubscription),
		})
		if res.Error != nil {
			return res.Error
		}
	}
	return nil
}

func GetRootUserEmail() (email string) {
	// 阶段 3 单源化：root 用户的 email 也走读穿账号中心,回退 users.email 兜底。
	// account_id 以 account_products 映射为权威,不读废弃的 users.account_id。
	var u struct {
		Id    int
		Email string
	}
	if err := DB.Model(&User{}).Where("role = ?", RoleRootUser).
		Select("id, email").Take(&u).Error; err != nil {
		return ""
	}
	return ResolveUserIdentifierByLocalUser(u.Id, IdentifierTypeEmail, u.Email)
}

func UpdateUserUsedQuotaAndRequestCount(id int, quota int64) {
	if config.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUsedQuota, id, quota)
		addNewRecord(BatchUpdateTypeRequestCount, id, 1)
		return
	}
	updateUserUsedQuotaAndRequestCount(id, quota, 1)
}

func updateUserUsedQuotaAndRequestCount(id int, quota int64, count int) {
	now := time.Now()
	err := DB.Model(&User{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"used_quota":     gorm.Expr("used_quota + ?", quota),
			"request_count":  gorm.Expr("request_count + ?", count),
			"last_active_at": now,
		},
	).Error
	if err != nil {
		logger.SysError("failed to update user used quota and request count: " + err.Error())
	}
}

func updateUserUsedQuota(id int, quota int64) {
	err := DB.Model(&User{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"used_quota": gorm.Expr("used_quota + ?", quota),
		},
	).Error
	if err != nil {
		logger.SysError("failed to update user used quota: " + err.Error())
	}
}

func updateUserRequestCount(id int, count int) {
	err := DB.Model(&User{}).Where("id = ?", id).Update("request_count", gorm.Expr("request_count + ?", count)).Error
	if err != nil {
		logger.SysError("failed to update user request count: " + err.Error())
	}
}

func GetUsernameById(id int) (username string) {
	getUserDB().Model(&User{}).Where("id = ?", id).Select("username").Find(&username)
	return username
}

func (user *User) FillUserByPhone(phone string) error {
	if phone == "" {
		return errors.New("phone 为空！")
	}
	// 阶段 4 单源化：先查账号中心 identifier 反查 user;账号中心未启用回退老路。
	if ACCOUNT_DB != nil {
		if u, ok := fillUserByAccountIdentifier(IdentifierTypePhone, phone); ok {
			*user = *u
			return nil
		}
	}
	return DB.Where("phone = ?", phone).First(user).Error
}

func IsPhoneAlreadyTaken(phone string) bool {
	// 阶段 4 单源化：phone 是受管标识,以账号中心为权威。
	if ACCOUNT_DB != nil {
		var n int64
		ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", IdentifierTypePhone, phone).Count(&n)
		return n > 0
	}
	return DB.Where("phone = ?", phone).Find(&User{}).RowsAffected == 1
}

// IsPhoneTakenByOther 判断手机号是否被「除自己外」的账户占用。
// 绑定/换绑查重必须排除当前用户自己的真实账号(account_products 映射),否则:
// 用户绑过号后,account_identifiers 已有该号 → 再次绑同号时全局查重命中的其实是自己,
// 误报「已被其他账户绑定」,陷入「绑了又被要求绑、再绑又被拒」死循环。
//
// 是 IsIdentifierTakenByOther 的 phone 特化(微信/邮箱/username 等同理,见各 ByOther 包装)。
func IsPhoneTakenByOther(phone string, localUserID int) bool {
	return IsIdentifierTakenByOther(IdentifierTypePhone, phone, localUserID)
}

// IsWeChatIdTakenByOther / IsEmailTakenByOther / IsUsernameTakenByOther / IsGitHubIdTakenByOther
// / IsLarkIdTakenByOther / IsOidcIdTakenByOther：与 phone 同构的「绑定查重排除自己」。
// 用于「已登录用户把某标识绑到自己账号」的场景(XxxBind),避免重复绑同值时误报已占用。
func IsWeChatIdTakenByOther(wechatId string, localUserID int) bool {
	return IsIdentifierTakenByOther(IdentifierTypeWeChat, wechatId, localUserID)
}
func IsEmailTakenByOther(email string, localUserID int) bool {
	return IsIdentifierTakenByOther(IdentifierTypeEmail, email, localUserID)
}
func IsUsernameTakenByOther(username string, localUserID int) bool {
	return IsIdentifierTakenByOther(IdentifierTypeUsername, username, localUserID)
}
func IsGitHubIdTakenByOther(githubId string, localUserID int) bool {
	return IsIdentifierTakenByOther(IdentifierTypeGitHub, githubId, localUserID)
}
func IsLarkIdTakenByOther(larkId string, localUserID int) bool {
	return IsIdentifierTakenByOther(IdentifierTypeLark, larkId, localUserID)
}
func IsOidcIdTakenByOther(oidcId string, localUserID int) bool {
	return IsIdentifierTakenByOther(IdentifierTypeOidc, oidcId, localUserID)
}

// usersColumnForIdentifierType 受管标识类型 → users 旧列名(账号中心未启用时的回退查重列)。
func usersColumnForIdentifierType(typ string) string {
	switch typ {
	case IdentifierTypePhone:
		return "phone"
	case IdentifierTypeEmail:
		return "email"
	case IdentifierTypeWeChat:
		return "wechat_id"
	case IdentifierTypeUsername:
		return "username"
	case IdentifierTypeGitHub:
		return "github_id"
	case IdentifierTypeLark:
		return "lark_id"
	case IdentifierTypeOidc:
		return "oidc_id"
	default:
		return ""
	}
}

// IsIdentifierTakenByOther 通用「绑定查重排除自己」:判断某受管标识值是否被除当前用户外的账户占用。
//
// account_id 以 account_products 映射为权威(ResolveAccountIDByLocalUser),不读废弃的
// users.account_id;否则历史分裂场景下「号已属自己却查到」会误报占用(手机号死循环根因)。
// 账号中心未启用时回退按 users 对应列 + id<>self 排除自己。
func IsIdentifierTakenByOther(typ, identifier string, localUserID int) bool {
	if identifier == "" {
		return false
	}
	if ACCOUNT_DB != nil {
		myAccID, ok := ResolveAccountIDByLocalUser(localUserID)
		q := ACCOUNT_DB.Model(&AccountIdentifier{}).
			Where("type = ? AND identifier = ?", typ, identifier)
		if ok && myAccID != 0 {
			q = q.Where("account_id <> ?", myAccID)
		}
		var n int64
		q.Count(&n)
		return n > 0
	}
	col := usersColumnForIdentifierType(typ)
	if col == "" {
		return false
	}
	var n int64
	DB.Model(&User{}).Where(col+" = ? AND id <> ?", identifier, localUserID).Count(&n)
	return n > 0
}

func UpdateUserPhone(userId int, newPhone string) error {
	if userId == 0 {
		return errors.New("user id 为空！")
	}
	if newPhone == "" {
		return errors.New("phone 为空！")
	}
	// 阶段 4 单源化：phone 是受管标识,以账号中心为唯一权威。
	// 账号中心启用 → 仅写账号中心,不写 users.phone(避免回冲)。
	// 账号中心未启用 → 回退老路直写 users 列,保持灰度期间不破坏功能。
	if ACCOUNT_DB != nil {
		return writeManagedIdentifierByLocalUser(userId, IdentifierTypePhone, newPhone, true, "update_phone")
	}
	return DB.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"phone":          newPhone,
		"phone_verified": true,
	}).Error
}

func ClearUserPhone(userId int) error {
	if userId == 0 {
		return errors.New("user id 为空！")
	}
	if ACCOUNT_DB != nil {
		return clearManagedIdentifierByLocalUser(userId, IdentifierTypePhone, "clear_phone")
	}
	return DB.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"phone":          "",
		"phone_verified": false,
	}).Error
}

func ClearUserWeChat(userId int) error {
	if userId == 0 {
		return errors.New("user id 为空！")
	}
	// 阶段 5 单源化：wechat 是受管标识,以账号中心为唯一权威。
	if ACCOUNT_DB != nil {
		return clearManagedIdentifierByLocalUser(userId, IdentifierTypeWeChat, "clear_wechat")
	}
	return DB.Model(&User{}).Where("id = ?", userId).Update("wechat_id", "").Error
}

// GenerateUniquePhoneUsername generates a unique username in format parvis_phone_00001
func GenerateUniquePhoneUsername() (string, error) {
	prefix := "parvis_phone_"

	// Find the highest existing number
	var maxUser User
	err := DB.Where("username LIKE ?", prefix+"%").
		Order("username DESC").
		First(&maxUser).Error

	nextNum := 1
	if err == nil && maxUser.Username != "" {
		// Extract number from username like "parvis_phone_00123"
		numStr := strings.TrimPrefix(maxUser.Username, prefix)
		if num, parseErr := fmt.Sscanf(numStr, "%d", &nextNum); parseErr == nil && num == 1 {
			nextNum++
		}
	}

	// Try to find an available username (in case of gaps)
	maxAttempts := 10000
	for i := 0; i < maxAttempts; i++ {
		username := fmt.Sprintf("%s%05d", prefix, nextNum)

		// Check if username exists
		var existingUser User
		err := DB.Where("username = ?", username).First(&existingUser).Error
		if err == gorm.ErrRecordNotFound {
			return username, nil
		}

		nextNum++
	}

	return "", errors.New("无法生成唯一用户名")
}

func GetAdminUsers() ([]*User, error) {
	var users []*User
	err := DB.Where("role >= ?", RoleAdminUser).
		Select("id, username, display_name, email, role, admin_permissions").
		Order("role DESC").
		Find(&users).Error
	return users, err
}

func UpdateAdminPermissions(userId int, permissions string) error {
	return DB.Model(&User{}).Where("id = ? AND role = ?", userId, RoleAdminUser).
		Update("admin_permissions", permissions).Error
}
