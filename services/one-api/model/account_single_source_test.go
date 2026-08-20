package model

import (
	"context"
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 阶段 3-5 + 7 单源化新行为回归测试.

func TestIsEmailAlreadyTaken_走账号中心(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "amy", Email: "amy@example.com", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	_, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	assert.True(t, IsEmailAlreadyTaken("amy@example.com"), "账号中心已有该 email,应返回 true")
	assert.False(t, IsEmailAlreadyTaken("nobody@example.com"), "账号中心没有的 email 应返回 false")
}

func TestFillUserByEmail_走账号中心(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "ben", Email: "ben@example.com", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	_, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	target := User{Email: "ben@example.com"}
	require.NoError(t, target.FillUserByEmail())
	assert.Equal(t, u.Id, target.Id)
}

func TestEmail受管类型_换邮箱后旧值不残留(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	u := &User{Username: "cathy", Email: "cathy@old.com", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 换邮箱
	u.Email = "cathy@new.com"
	_, err = EnsureAccountForUser(u)
	require.NoError(t, err)

	var emails []AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ? AND type = ?", accID, IdentifierTypeEmail).Find(&emails).Error)
	require.Len(t, emails, 1, "受管类型(阶段 3)email 应只有一行,旧值不残留")
	assert.Equal(t, "cathy@new.com", emails[0].Identifier)
}

func TestIsPhoneAlreadyTaken_走账号中心(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "diana", Phone: "+8613811112222", PhoneVerified: true, Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	_, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	assert.True(t, IsPhoneAlreadyTaken("+8613811112222"))
	assert.False(t, IsPhoneAlreadyTaken("+8613833334444"))
}

func TestGetUserById_自动Overlay(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	u := &User{Username: "ed", Phone: "+8613800009999", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 直接改账号中心 phone(模拟单源后只动账号中心的场景)
	require.NoError(t, accDB.Model(&AccountIdentifier{}).
		Where("account_id = ? AND type = ?", accID, IdentifierTypePhone).
		Update("identifier", "+8613911118888").Error)

	got, err := GetUserById(u.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "+8613911118888", got.Phone, "GetUserById 应自动 Overlay 取账号中心新值")
}

func TestSearchUsers_账号中心两步查(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "frank_search", Email: "search@example.com", Phone: "+8613744445555", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	_, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 按 email 前缀搜:走账号中心两步查找到该用户
	results, err := SearchUsers("search@")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, u.Id, results[0].Id)

	// 按 phone 前缀搜:也应命中
	results2, err := SearchUsers("+861374")
	require.NoError(t, err)
	require.Len(t, results2, 1)
	assert.Equal(t, u.Id, results2[0].Id)
}

func TestValidateAccountPasswordByLocalUserID_命中与回退(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "henry_pwd", Password: "$2a$10$abcdefghijklmnopqrstuv", Status: UserStatusEnabled, AccessToken: "tok_henry", AffCode: "aff_henry"}
	require.NoError(t, mainDB.Create(u).Error)
	_, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	// 错误密码 → 命中且 false
	ok, err := ValidateAccountPasswordByLocalUserID(u.Id, "wrong")
	require.NoError(t, err)
	assert.False(t, ok)

	// 未投影用户 → 回退老路 ErrFallbackToLegacyPassword
	u2 := &User{Username: "ghost_pwd", Password: "$2a$10$xxx", Status: UserStatusEnabled, AccessToken: "tok_ghost", AffCode: "aff_ghost"}
	require.NoError(t, mainDB.Create(u2).Error)
	_, err = ValidateAccountPasswordByLocalUserID(u2.Id, "anything")
	assert.ErrorIs(t, err, ErrFallbackToLegacyPassword)
}

// 阶段 4：phone 单源 —— UpdateUserPhone 不再写 users.phone,只写账号中心。
func TestUpdateUserPhone_单源不写users(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	u := &User{Username: "ivy", Phone: "+8613711110000", PhoneVerified: true, Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	require.NoError(t, UpdateUserPhone(u.Id, "+8613722220000"))

	// users.phone 应保持旧值(单源后停写)
	var raw User
	require.NoError(t, mainDB.Select("phone").First(&raw, "id = ?", u.Id).Error)
	assert.Equal(t, "+8613711110000", raw.Phone, "users.phone 单源后停写,应保持旧值")

	// 账号中心应有新值,且只一行(受管类型先删后建)
	var idents []AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ? AND type = ?", accID, IdentifierTypePhone).Find(&idents).Error)
	require.Len(t, idents, 1)
	assert.Equal(t, "+8613722220000", idents[0].Identifier)
	assert.True(t, idents[0].Verified)

	// GetUserById 走 OverlayUsersIdentity 应取到账号中心新值
	got, err := GetUserById(u.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "+8613722220000", got.Phone)
}

func TestClearUserPhone_单源不写users(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	u := &User{Username: "jack", Phone: "+8613788889999", PhoneVerified: true, Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	require.NoError(t, ClearUserPhone(u.Id))

	var raw User
	require.NoError(t, mainDB.Select("phone").First(&raw, "id = ?", u.Id).Error)
	assert.Equal(t, "+8613788889999", raw.Phone, "users.phone 单源后停写,应保持旧值")

	var n int64
	require.NoError(t, accDB.Model(&AccountIdentifier{}).
		Where("account_id = ? AND type = ?", accID, IdentifierTypePhone).Count(&n).Error)
	assert.Zero(t, n, "账号中心 phone 标识应被清空")
}

// 阶段 5：wechat/lark/oidc/github 单源 —— WriteAccountIdentifierByLocalUser 写入。
func TestWriteAccountIdentifierByLocalUser_先删后建(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	u := &User{Username: "kate", WeChatId: "wx_old_unionid", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	accID, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	require.NoError(t, WriteAccountIdentifierByLocalUser(u.Id, IdentifierTypeWeChat,
		"wx_new_unionid", true, "test_rebind"))

	var rows []AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ? AND type = ?", accID, IdentifierTypeWeChat).Find(&rows).Error)
	require.Len(t, rows, 1, "受管类型应先删后建,只一行")
	assert.Equal(t, "wx_new_unionid", rows[0].Identifier)
}

// 阶段 6：username 单源 —— IsUsernameAlreadyTaken 与 FillUserByUsername 走账号中心。
func TestIsUsernameAlreadyTaken_走账号中心(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "leo_unique", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	_, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	assert.True(t, IsUsernameAlreadyTaken("leo_unique"))
	assert.False(t, IsUsernameAlreadyTaken("not_exist_user"))
}

func TestFillUserByUsername_走账号中心(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "mia", Status: UserStatusEnabled}
	require.NoError(t, mainDB.Create(u).Error)
	_, err := EnsureAccountForUser(u)
	require.NoError(t, err)

	target := User{Username: "mia"}
	require.NoError(t, target.FillUserByUsername())
	assert.Equal(t, u.Id, target.Id)
}

// 单源化最终验证：User.Insert 走完后,users 表身份字段列应全部停写,
// 真实身份值只在 account_identifiers / account_profiles 中。
func TestUserInsert_users身份列全部停写(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{
		Username:    "alice_pure",
		Password:    "pwd12345",
		DisplayName: "Alice 名字",
		Email:       "alice@example.com",
		Phone:       "+8613911118888",
		WeChatId:    "wx_alice_unionid",
		GitHubId:    "alice-gh",
		LarkId:      "alice_lark",
		OidcId:      "alice_oidc",
		Status:      UserStatusEnabled,
		Role:        RoleCommonUser,
	}
	require.NoError(t, u.Insert(context.Background(), 0))
	require.NotNil(t, u.AccountId)
	require.NotZero(t, *u.AccountId)

	// 直读 users 表(绕过 Overlay)断言身份列全部停写
	var raw struct {
		Username      string
		Password      string
		DisplayName   string
		Email         string
		Phone         string
		PhoneVerified bool
		WeChatId      string
		GitHubId      string
		LarkId        string
		OidcId        string
	}
	require.NoError(t, mainDB.Table("users").Where("id = ?", u.Id).
		Select("username, password, display_name, email, phone, phone_verified, wechat_id, github_id, lark_id, oidc_id").
		Take(&raw).Error)

	assert.Empty(t, raw.Password, "users.password 应停写")
	assert.Empty(t, raw.DisplayName, "users.display_name 应停写")
	assert.Empty(t, raw.Email, "users.email 应停写")
	assert.Empty(t, raw.Phone, "users.phone 应停写")
	assert.False(t, raw.PhoneVerified, "users.phone_verified 应停写")
	assert.Empty(t, raw.WeChatId, "users.wechat_id 应停写")
	assert.Empty(t, raw.GitHubId, "users.github_id 应停写")
	assert.Empty(t, raw.LarkId, "users.lark_id 应停写")
	assert.Empty(t, raw.OidcId, "users.oidc_id 应停写")
	// username 必有非空占位以满足 unique 索引,但不等于真实输入
	assert.NotEmpty(t, raw.Username, "users.username 应有占位非空")
	assert.NotEqual(t, "alice_pure", raw.Username, "users.username 不能落真实值")

	// 账号中心应有完整身份记录
	accID := *u.AccountId
	expects := map[string]string{
		IdentifierTypeUsername: "alice_pure",
		IdentifierTypeEmail:    "alice@example.com",
		IdentifierTypePhone:    "+8613911118888",
		IdentifierTypeWeChat:   "wx_alice_unionid",
		IdentifierTypeGitHub:   "alice-gh",
		IdentifierTypeLark:     "alice_lark",
		IdentifierTypeOidc:     "alice_oidc",
	}
	for typ, want := range expects {
		var ident AccountIdentifier
		require.NoError(t, accDB.Where("account_id = ? AND type = ?", accID, typ).First(&ident).Error,
			"账号中心应有 %s 标识", typ)
		assert.Equal(t, want, ident.Identifier, "账号中心 %s 应等于输入值", typ)
	}

	// account_profiles 应有 display_name
	var profile AccountProfile
	require.NoError(t, accDB.First(&profile, "account_id = ?", accID).Error)
	assert.Equal(t, "Alice 名字", profile.DisplayName)

	// account_credentials 应有 hash 后的密码
	var cred AccountCredential
	require.NoError(t, accDB.First(&cred, "account_id = ?", accID).Error)
	assert.NotEmpty(t, cred.PasswordHash)

	// 内存里的 u 字段应被还原为真实值,供调用方(SetupLogin/cleanUser)使用
	assert.Equal(t, "alice_pure", u.Username)
	assert.Equal(t, "alice@example.com", u.Email)
	assert.Equal(t, "+8613911118888", u.Phone)
}

// 关键回归: User.Insert 启用账号中心后 users.username 是 acc_<ts>_<rand> 占位串。
// 之后任意 User.Update 触发的 SyncAccountByUserID 必须用账号中心权威值覆盖 reload 出的
// 占位串再投影,否则 EnsureAccountForUser「先删后建」会把账号中心真实 username 标识
// 替换为 acc_xxx,phone/email/wechat 也会因 reload 出的空值被一并清空。
func TestUserUpdate后账号中心标识不被占位串覆盖(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{
		Username:      "real_username",
		Password:      "pwd12345",
		Email:         "real@example.com",
		Phone:         "+8613900000777",
		PhoneVerified: true,
		WeChatId:      "wx_real_unionid",
		Status:        UserStatusEnabled,
	}
	require.NoError(t, u.Insert(context.Background(), 0))
	require.NotNil(t, u.AccountId)
	accID := *u.AccountId

	// 模拟管理员改 status: 用部分字段结构体走 User.Update,触发 SyncAccountByUserID
	target := User{Id: u.Id, Status: UserStatusEnabled}
	require.NoError(t, target.Update(false))

	// 受管标识必须仍是真实值
	rows := map[string]string{}
	var idents []AccountIdentifier
	require.NoError(t, accDB.Where("account_id = ?", accID).Find(&idents).Error)
	for _, r := range idents {
		rows[r.Type] = r.Identifier
	}
	assert.Equal(t, "real_username", rows[IdentifierTypeUsername], "username 必须保持真实值,不能被 acc_xxx 占位串覆盖")
	assert.Equal(t, "real@example.com", rows[IdentifierTypeEmail], "email 不能被 reload 的空值清空")
	assert.Equal(t, "+8613900000777", rows[IdentifierTypePhone], "phone 不能被 reload 的空值清空")
	assert.Equal(t, "wx_real_unionid", rows[IdentifierTypeWeChat], "wechat 不能被 reload 的空值清空")
}

// 关键回归: 改密后 SyncAccountByUserID 不得用 users.password 旧哈希回冲账号中心。
// 复现的线上 bug: ResetPasswordByPhone -> User.Update(true) 先用
// WriteAccountCredentialByLocalUser 写新密码,随后 SyncAccountByUserID reload 出
// users.password(停写,仍是旧哈希),经 EnsureAccountForUser 第 68 行 upsert 覆盖回旧值,
// 导致「改密成功但新密码登录失败」。修复后 SyncAccountByUserID 不再携带 password。
func TestUserUpdate改密后新密码不被旧哈希回冲(t *testing.T) {
	mainDB, accDB := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{
		Username:      "pwd_user",
		Password:      "oldpwd123",
		Phone:         "+8613900001234",
		PhoneVerified: true,
		Status:        UserStatusEnabled,
	}
	require.NoError(t, u.Insert(context.Background(), 0))
	accID := *u.AccountId

	// 复现线上触发条件: 迁移用户的 users.password 残留旧哈希(Insert 出来的用户该列为空,
	// 不会触发 bug;线上 273/332 用户该列非空)。手动写入旧哈希模拟迁移态。
	oldHash, _ := common.Password2Hash("oldpwd123")
	require.NoError(t, mainDB.Model(&User{}).Where("id = ?", u.Id).Update("password", oldHash).Error)

	// 注册后账号中心应认旧密码
	var cred0 AccountCredential
	require.NoError(t, accDB.First(&cred0, "account_id = ?", accID).Error)
	require.True(t, common.ValidatePasswordAndHash("oldpwd123", cred0.PasswordHash), "前置: 旧密码应能通过")

	// 模拟 ResetPasswordByPhone: User.Update(true) 改密
	target := User{Id: u.Id, Password: "newpwd456"}
	require.NoError(t, target.Update(true))

	// 账号中心 credential 必须是新密码,旧密码必须失效
	var cred1 AccountCredential
	require.NoError(t, accDB.First(&cred1, "account_id = ?", accID).Error)
	assert.True(t, common.ValidatePasswordAndHash("newpwd456", cred1.PasswordHash),
		"改密后新密码必须通过 —— SyncAccountByUserID 不得用旧哈希回冲")
	assert.False(t, common.ValidatePasswordAndHash("oldpwd123", cred1.PasswordHash),
		"改密后旧密码必须失效")
}

// 关键回归: 阶段 6 后 SearchUsers 必须能按真实 username 前缀搜到用户
// (users.username 是占位,只能走账号中心 account_identifiers)。
func TestSearchUsers_按真实Username搜索(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{Username: "searchable_alice", Status: UserStatusEnabled}
	require.NoError(t, u.Insert(context.Background(), 0))

	results, err := SearchUsers("searchable_")
	require.NoError(t, err)
	require.Len(t, results, 1, "按真实 username 前缀必须命中,占位 acc_xxx 不应妨碍搜索")
	assert.Equal(t, u.Id, results[0].Id)
}

// 关键回归: GetUserByUsername 在阶段 6 启用后必须能按真实 username 找到用户。
func TestGetUserByUsername_单源后仍可用(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	require.NoError(t, mainDB.AutoMigrate(&UserTimedQuota{}, &Token{}, &Log{}))

	u := &User{Username: "lookup_target", Status: UserStatusEnabled}
	require.NoError(t, u.Insert(context.Background(), 0))

	got, err := GetUserByUsername("lookup_target")
	require.NoError(t, err)
	assert.Equal(t, u.Id, got.Id)
	assert.Equal(t, "lookup_target", got.Username, "Overlay 应让真实 username 可见")

	// 不存在用户应返回 ErrRecordNotFound
	_, err = GetUserByUsername("nonexistent_user")
	assert.Error(t, err)
}

// TestAccountIdMismatch_读写以account_products为准 复现并验证手机号绑定死循环的修复:
// 当 users.account_id 与 account_products.account_id 脱节(历史分裂)时,
// 真实身份标识全挂在 account_products.account_id 下。读取(Overlay/状态)和查重必须
// 以 account_products 为准,否则会「绑了仍提示未绑、再绑又报已被占用」。
func TestAccountIdMismatch_读写以account_products为准(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	u := &User{Username: "mismatch_user", Phone: "+8613800001111", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_mm", AffCode: "aff_mm"}
	require.NoError(t, mainDB.Create(u).Error)
	realAccID, err := EnsureAccountForUser(u)
	require.NoError(t, err)
	require.NotZero(t, realAccID)

	// 模拟历史分裂:把 users.account_id 改写成一个不存在 identifier 的「废弃」account_id,
	// 真实手机号仍挂在 account_products.account_id(realAccID)下。
	staleAccID := realAccID + 999999
	require.NoError(t, mainDB.Model(&User{}).Where("id = ?", u.Id).
		Update("account_id", staleAccID).Error)

	// 1) 读取:GetUserById 走 Overlay,应以 account_products 为准取到真实手机号,
	//    而非按废弃的 users.account_id 读到空账号。
	got, err := GetUserById(u.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "+8613800001111", got.Phone, "应按 account_products 真实账号读到手机号")
	assert.True(t, got.PhoneVerified, "verified 也应取自真实账号")

	// 2) 状态解析:ResolveUserIdentifierByLocalUser 同样以 account_products 为准。
	phone := ResolveUserIdentifierByLocalUser(u.Id, IdentifierTypePhone, "")
	assert.Equal(t, "+8613800001111", phone)

	// 3) 查重排除自己:同号绑定不应被判「已被其他账户绑定」(否则死循环)。
	assert.False(t, IsPhoneTakenByOther("+8613800001111", u.Id),
		"号码属于当前用户自己,不应算被占用")

	// 4) 真正被别人占用才返回 true。
	other := &User{Username: "other_user", Phone: "+8613822223333", PhoneVerified: true, Status: UserStatusEnabled, AccessToken: "tok_other", AffCode: "aff_other"}
	require.NoError(t, mainDB.Create(other).Error)
	_, err = EnsureAccountForUser(other)
	require.NoError(t, err)
	assert.True(t, IsPhoneTakenByOther("+8613822223333", u.Id),
		"号码属于别的账户,应算被占用")

	// 5) 对齐写:对脱节用户重新投影,应把 users.account_id 纠正回真实 account_id。
	var stale User
	require.NoError(t, mainDB.First(&stale, "id = ?", u.Id).Error)
	require.NotNil(t, stale.AccountId)
	require.Equal(t, staleAccID, *stale.AccountId, "前置:此时仍是脱节值")
	_, err = EnsureAccountForUser(&stale) // 映射优先 → accID=realAccID,触发对齐写
	require.NoError(t, err)

	var fixed User
	require.NoError(t, mainDB.Select("account_id").First(&fixed, "id = ?", u.Id).Error)
	require.NotNil(t, fixed.AccountId)
	assert.Equal(t, realAccID, *fixed.AccountId, "对齐写应把 users.account_id 纠正为真实 account_id")
}

// TestIsIdentifierTakenByOther_排除自己 验证微信/邮箱等受管标识的「绑定查重排除自己」,
// 与手机号同构:已绑到自己账号不算被占用,绑到别的账号才算。
func TestIsIdentifierTakenByOther_排除自己(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	me := &User{Username: "wx_me", WeChatId: "wx_openid_aaa", Status: UserStatusEnabled, AccessToken: "tok_wxme", AffCode: "aff_wxme"}
	require.NoError(t, mainDB.Create(me).Error)
	_, err := EnsureAccountForUser(me)
	require.NoError(t, err)

	// 微信已绑在自己账号下 → 重复绑同值不算被占用(否则前端报「已被绑定」)。
	assert.False(t, IsWeChatIdTakenByOther("wx_openid_aaa", me.Id), "自己已绑的微信不算被占用")
	assert.False(t, IsIdentifierTakenByOther(IdentifierTypeWeChat, "wx_openid_aaa", me.Id))

	// 绑到别人账号下 → 算被占用。
	other := &User{Username: "wx_other", WeChatId: "wx_openid_bbb", Status: UserStatusEnabled, AccessToken: "tok_wxot", AffCode: "aff_wxot"}
	require.NoError(t, mainDB.Create(other).Error)
	_, err = EnsureAccountForUser(other)
	require.NoError(t, err)
	assert.True(t, IsWeChatIdTakenByOther("wx_openid_bbb", me.Id), "别人已绑的微信应算被占用")

	// 完全没人绑过的标识 → 不算被占用。
	assert.False(t, IsWeChatIdTakenByOther("wx_openid_zzz", me.Id))
	assert.False(t, IsIdentifierTakenByOther(IdentifierTypeWeChat, "", me.Id), "空值不算被占用")
}
