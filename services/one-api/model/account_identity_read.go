package model

import (
	"errors"

	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
)

// 身份标识（A 类：phone/email/wechat 等登录身份）的读穿模块。
//
// 「库可换」铁律：对账号库的访问全部收口在 account_*.go，业务层只调这里的函数，
// 绝不直接碰 ACCOUNT_DB、绝不跨库 JOIN。将来账号中心换库或变远程服务，只换本模块。
//
// 本期（S6 选项 2）：把「纯展示/对外使用」的身份字段读取改成读穿账号中心，
// 但 users 旧列继续双写保留作兜底。账号中心未启用 / 未迁移用户 / 查不到标识时，
// 一律回退用 users 的值——故业务层应优先调下方 ResolveUser* 封装，而非裸读账号库。

// ResolveAccountIDByLocalUser 按本地 user_id 取「真实」account_id：以 account_products
// 映射(product_code=parvis, local_user_id)为唯一权威。
//
// 为什么不读 users.account_id：历史投影曾把同一本地用户分裂成两套 account_id——
// users.account_id 是废弃死值(其名下无任何 identifier),所有身份标识都挂在
// account_products.account_id 下(写入路径 writeManagedIdentifierByLocalUser 也走它)。
// 读取若用 users.account_id 会读到空账号,导致手机号「绑了仍提示未绑」死循环。
// 故读取一律收口到本函数,与写入路径同源。
//
// 账号中心未启用 / 无映射 → 返回 (0, false),调用方据此回退 users 旧值。
func ResolveAccountIDByLocalUser(localUserID int) (int64, bool) {
	if ACCOUNT_DB == nil || localUserID == 0 {
		return 0, false
	}
	var ap AccountProduct
	err := ACCOUNT_DB.Select("account_id").
		Where("product_code = ? AND local_user_id = ?", ProductCodeParvis, int64(localUserID)).
		First(&ap).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false
	}
	if err != nil {
		logger.SysErrorf("ResolveAccountIDByLocalUser 查 account_products 失败(user=%d),回退 users 旧值: %v", localUserID, err)
		return 0, false
	}
	return ap.AccountId, true
}

// ResolveAccountIDsByLocalUsers 批量版：一次取多个本地用户的真实 account_id,杜绝 N+1。
// 供 OverlayUsersIdentity 等列表场景用。返回 map[local_user_id]account_id；
// 账号中心未启用 / 入参为空 / 无映射的用户不在 map 中(调用方回退 users 旧值)。
func ResolveAccountIDsByLocalUsers(localUserIDs []int) map[int]int64 {
	out := make(map[int]int64, len(localUserIDs))
	if ACCOUNT_DB == nil || len(localUserIDs) == 0 {
		return out
	}
	ids := make([]int64, 0, len(localUserIDs))
	for _, id := range localUserIDs {
		if id != 0 {
			ids = append(ids, int64(id))
		}
	}
	if len(ids) == 0 {
		return out
	}
	var rows []AccountProduct
	if err := ACCOUNT_DB.Select("account_id", "local_user_id").
		Where("product_code = ? AND local_user_id IN ?", ProductCodeParvis, ids).
		Find(&rows).Error; err != nil {
		logger.SysErrorf("ResolveAccountIDsByLocalUsers 批量查 account_products 失败,列表回退 users 旧值: %v", err)
		return out
	}
	for i := range rows {
		out[int(rows[i].LocalUserId)] = rows[i].AccountId
	}
	return out
}

// GetAccountIdentifier 按 account_id + type 读单个身份标识值。
// 账号中心未启用返回 ErrAccountCenterDisabled；标识不存在返回 ("", nil)，
// 调用方据此回退 users 值（见 ResolveUserIdentifier）。
func GetAccountIdentifier(accountID int64, typ string) (string, error) {
	if ACCOUNT_DB == nil {
		return "", ErrAccountCenterDisabled
	}
	if accountID == 0 {
		return "", nil
	}
	var ident AccountIdentifier
	err := ACCOUNT_DB.Select("identifier").
		Where("account_id = ? AND type = ?", accountID, typ).
		First(&ident).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return ident.Identifier, nil
}

// GetAccountIdentifiers 批量读穿：一次取多个账号、多种类型的标识，杜绝 N+1。
// 返回 map[account_id]map[type]identifier；缺失的 account_id/type 不在 map 中。
// 账号中心未启用或入参为空时返回空 map（调用方回退 users 值）。
func GetAccountIdentifiers(accountIDs []int64, types []string) (map[int64]map[string]string, error) {
	out := make(map[int64]map[string]string, len(accountIDs))
	if ACCOUNT_DB == nil || len(accountIDs) == 0 || len(types) == 0 {
		return out, nil
	}
	var rows []AccountIdentifier
	if err := ACCOUNT_DB.Select("account_id", "type", "identifier").
		Where("account_id IN ? AND type IN ?", accountIDs, types).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		m, ok := out[rows[i].AccountId]
		if !ok {
			m = make(map[string]string, len(types))
			out[rows[i].AccountId] = m
		}
		m[rows[i].Type] = rows[i].Identifier
	}
	return out, nil
}

// GetAccountIdentifiersFull 同 GetAccountIdentifiers 但返回完整 identifier 行，
// 调用方需要 verified 字段（如 OverlayUsersIdentity 覆盖 PhoneVerified）时使用。
func GetAccountIdentifiersFull(accountIDs []int64, types []string) (map[int64]map[string]AccountIdentifier, error) {
	out := make(map[int64]map[string]AccountIdentifier, len(accountIDs))
	if ACCOUNT_DB == nil || len(accountIDs) == 0 || len(types) == 0 {
		return out, nil
	}
	var rows []AccountIdentifier
	if err := ACCOUNT_DB.
		Where("account_id IN ? AND type IN ?", accountIDs, types).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		m, ok := out[rows[i].AccountId]
		if !ok {
			m = make(map[string]AccountIdentifier, len(types))
			out[rows[i].AccountId] = m
		}
		m[rows[i].Type] = rows[i]
	}
	return out, nil
}

// ResolveUserIdentifier 读穿 + 回退的统一封装：单点场景调它即可。
//   - 账号中心未启用 / accountID 为 0（未迁移）/ 查不到 → 返回 fallback（users 当前值）。
//   - 命中 → 返回账号中心值。
//
// 这样调用点无需各自处理「未启用/未迁移/缺失」三态，行为一致，且账号中心抖动不影响展示。
// 出错路径打日志(与 authByAccountCenter 一致),避免账号库故障静默穿透到展示层。
func ResolveUserIdentifier(accountID *int64, typ, fallback string) string {
	if ACCOUNT_DB == nil || accountID == nil || *accountID == 0 {
		return fallback
	}
	val, err := GetAccountIdentifier(*accountID, typ)
	if err != nil {
		logger.SysErrorf("ResolveUserIdentifier 读账号中心失败(account=%d, type=%s),回退 users 旧值: %v",
			*accountID, typ, err)
		return fallback
	}
	if val == "" {
		return fallback
	}
	return val
}

// ResolveUserPhone 读穿 phone 标识 + verified 字段：阶段 4 单源化的统一封装。
// 既返回 phone 值,也返回是否已验证;未启用/未迁移/查不到则回退 users 当前值。
//
// 用法举例(替代裸读 user.Phone / user.PhoneVerified):
//
//	phone, verified := model.ResolveUserPhone(user.AccountId, user.Phone, user.PhoneVerified)
//	if phone == "" || !verified { ... }
func ResolveUserPhone(accountID *int64, fallbackPhone string, fallbackVerified bool) (string, bool) {
	if ACCOUNT_DB == nil || accountID == nil || *accountID == 0 {
		return fallbackPhone, fallbackVerified
	}
	var ident AccountIdentifier
	err := ACCOUNT_DB.Select("identifier", "verified").
		Where("account_id = ? AND type = ?", *accountID, IdentifierTypePhone).
		First(&ident).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fallbackPhone, fallbackVerified
	}
	if err != nil {
		logger.SysErrorf("ResolveUserPhone 读账号中心失败(account=%d),回退 users 旧值: %v", *accountID, err)
		return fallbackPhone, fallbackVerified
	}
	if ident.Identifier == "" {
		return fallbackPhone, fallbackVerified
	}
	return ident.Identifier, ident.Verified
}

// ResolveUserDisplayName 读穿 B 类档案：账号中心是 display_name 唯一权威写入源。
// 三态回退语义同 ResolveUserIdentifier：未启用/未迁移/查不到 → fallback。
func ResolveUserDisplayName(accountID *int64, fallback string) string {
	if ACCOUNT_DB == nil || accountID == nil || *accountID == 0 {
		return fallback
	}
	p, err := GetAccountProfile(*accountID)
	if err != nil {
		logger.SysErrorf("ResolveUserDisplayName 读账号中心失败(account=%d),回退 users 旧值: %v", *accountID, err)
		return fallback
	}
	if p == nil || p.DisplayName == "" {
		return fallback
	}
	return p.DisplayName
}

// 下面三个 ByLocalUser 包装:account_id 以 account_products 映射为权威(见
// ResolveAccountIDByLocalUser),替代旧的「传 user.AccountId」单点读取。无映射时回退 fallback。

// ResolveUserIdentifierByLocalUser 同 ResolveUserIdentifier,但按本地 user_id 解析真实 account_id。
func ResolveUserIdentifierByLocalUser(localUserID int, typ, fallback string) string {
	accID, ok := ResolveAccountIDByLocalUser(localUserID)
	if !ok {
		return fallback
	}
	return ResolveUserIdentifier(&accID, typ, fallback)
}

// ResolveUserDisplayNameByLocalUser 同 ResolveUserDisplayName,但按本地 user_id 解析真实 account_id。
func ResolveUserDisplayNameByLocalUser(localUserID int, fallback string) string {
	accID, ok := ResolveAccountIDByLocalUser(localUserID)
	if !ok {
		return fallback
	}
	return ResolveUserDisplayName(&accID, fallback)
}

// OverlayUsersIdentity 批量读穿：把一组 User 的 phone / email / display_name 展示值
// 就地覆盖为账号中心值，供后台用户列表等列表场景使用，一次批量查询杜绝 N+1。
// 账号中心未启用时直接返回（保持 users 原值）；某用户未迁移或账号中心缺该标识则保留其 users 值。
//
// phone / email 走 account_identifiers（受管标识，阶段 3 起 email 为受管类型先删后建）；
// display_name 走 account_profiles（B 类档案，账号中心是唯一权威写入源）。
func OverlayUsersIdentity(users []*User) {
	if ACCOUNT_DB == nil || len(users) == 0 {
		return
	}
	// 单源化关键修复:account_id 以 account_products 映射(local_user_id)为唯一权威,
	// 不读废弃的 users.account_id(见 ResolveAccountIDByLocalUser 说明)。否则会读到
	// 空账号,导致手机号等标识「已绑仍显示未绑」。
	localIDs := make([]int, 0, len(users))
	for _, u := range users {
		if u != nil && u.Id != 0 {
			localIDs = append(localIDs, u.Id)
		}
	}
	accIDByLocal := ResolveAccountIDsByLocalUsers(localIDs)
	if len(accIDByLocal) == 0 {
		return
	}
	accIDs := make([]int64, 0, len(accIDByLocal))
	for _, accID := range accIDByLocal {
		accIDs = append(accIDs, accID)
	}

	idMap, err := GetAccountIdentifiersFull(accIDs, []string{
		IdentifierTypePhone, IdentifierTypeEmail, IdentifierTypeUsername,
		IdentifierTypeWeChat, IdentifierTypeGitHub, IdentifierTypeLark, IdentifierTypeOidc,
	})
	if err != nil {
		logger.SysErrorf("账号中心批量读穿身份标识失败,列表回退 users 原值: %v", err)
		idMap = nil
	}
	profileMap, err := GetAccountProfiles(accIDs)
	if err != nil {
		logger.SysErrorf("账号中心批量读穿档案失败,列表回退 users 原值: %v", err)
		profileMap = nil
	}

	for _, u := range users {
		if u == nil || u.Id == 0 {
			continue
		}
		accID, ok := accIDByLocal[u.Id]
		if !ok || accID == 0 {
			continue // 该用户无 account_products 映射(未投影),保留 users 旧值。
		}
		// idMap == nil 表示账号中心查询失败,保留 users 旧值不动避免误清;
		// idMap != nil 时,即使该 account 在 idMap 没 entry 也视为「账号中心确认无绑定」,
		// 受管类型须清空 users 旧列,否则解绑后旧值会让前端误显示「已绑定」。
		if idMap != nil {
			idents := idMap[accID] // map 缺 key → nil,索引 nil map 返回零值,等价无 entry
			// 受管类型(phone/email/wechat):账号中心唯一权威,无记录=未绑定,清空 users 列。
			if row, ok := idents[IdentifierTypePhone]; ok && row.Identifier != "" {
				u.Phone = row.Identifier
				u.PhoneVerified = row.Verified
			} else {
				u.Phone = ""
				u.PhoneVerified = false
			}
			if row, ok := idents[IdentifierTypeEmail]; ok && row.Identifier != "" {
				u.Email = row.Identifier
			} else {
				u.Email = ""
			}
			if row, ok := idents[IdentifierTypeWeChat]; ok && row.Identifier != "" {
				u.WeChatId = row.Identifier
			} else {
				u.WeChatId = ""
			}
			// username 单源化:账号中心是权威。但 users.username 是 acc_* 占位非空(唯一索引必需),
			// 不能清空;只在账号中心有真值时覆盖为真名,缺则保留占位。
			if row, ok := idents[IdentifierTypeUsername]; ok && row.Identifier != "" {
				u.Username = row.Identifier
			}
			// github/lark/oidc 是历史追加型,无解绑入口;保留覆盖语义不清空,
			// 避免老用户尚未投影时把 users 旧 OAuth 标识抹掉。
			if row, ok := idents[IdentifierTypeGitHub]; ok && row.Identifier != "" {
				u.GitHubId = row.Identifier
			}
			if row, ok := idents[IdentifierTypeLark]; ok && row.Identifier != "" {
				u.LarkId = row.Identifier
			}
			if row, ok := idents[IdentifierTypeOidc]; ok && row.Identifier != "" {
				u.OidcId = row.Identifier
			}
		}
		if p, ok := profileMap[accID]; ok && p != nil && p.DisplayName != "" {
			u.DisplayName = p.DisplayName
		}
	}
}
