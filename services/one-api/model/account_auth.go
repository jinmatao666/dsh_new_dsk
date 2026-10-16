package model

import (
	"errors"
	"strings"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
)

// 阶段 C：登录读路径切换到账号中心。
//
// 认证主体从「直接查 users 表」改为「账号中心校验 identifier+密码 → account_id →
// account_products 映射 → 载入 parvis 本地 user」。账号中心未启用、用户未迁移、或映射
// 缺失时，一律回退老路（直接查 users），保证灰度期间零认证中断。

// normalizeLoginPhone 把用户输入归一为 E.164（与 ValidateAndFill 老逻辑一致）。
func normalizeLoginPhone(input string) string {
	phone := input
	if !strings.HasPrefix(phone, "+") {
		if strings.HasPrefix(phone, "86") && len(phone) >= 13 {
			phone = "+" + phone
		} else if len(phone) == 11 && phone[0] == '1' {
			phone = "+86" + phone
		}
	}
	return phone
}

// authByAccountCenter 用账号中心校验「登录名+密码」，成功则返回对应的 parvis 本地 user。
//
// 返回 (user, true, nil)：账号中心命中并校验通过，user 已填充。
// 返回 (nil, false, nil)：账号中心无法处理此登录（未启用/标识不存在/无 parvis 映射），
//
//	调用方应回退老路。注意：标识存在但密码错，返回 (nil, false, err)。
//
// 返回 (nil, false, err)：账号中心命中但校验失败（密码错/被禁用）——这是确定性失败，
//
//	不回退，直接把错误抛给用户，避免老路给出不一致结果。
func authByAccountCenter(loginName, password string) (*User, bool, error) {
	if ACCOUNT_DB == nil {
		return nil, false, nil
	}

	// 1) 解析登录名 → identifier 行。登录名可能是用户名 / 手机号 / 邮箱（与老路 ValidateAndFill
	//    支持的三种登录入口对齐）。漏掉 email 候选会让阶段 2 单源化后 email 登录走老路,
	//    碰上 users.password 与账号中心 password_hash 不一致的窗口会拿到错误结果。
	candidates := []struct{ typ, val string }{
		{IdentifierTypeUsername, loginName},
		{IdentifierTypePhone, normalizeLoginPhone(loginName)},
		{IdentifierTypeEmail, loginName},
	}
	var ident AccountIdentifier
	found := false
	for _, c := range candidates {
		err := ACCOUNT_DB.Where("type = ? AND identifier = ?", c.typ, c.val).First(&ident).Error
		if err == nil {
			found = true
			break
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			// 账号库故障（连接抖动/超时/语法错）→ 打日志后回退老路，避免静默穿透。
			logger.SysErrorf("账号中心查询 identifier 失败(type=%s)，回退老路: %v", c.typ, err)
			return nil, false, nil
		}
	}
	if !found {
		return nil, false, nil // 账号中心不认识 → 回退老路
	}

	// 2) 校验账号级密码。
	var cred AccountCredential
	if err := ACCOUNT_DB.First(&cred, "account_id = ?", ident.AccountId).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			logger.SysErrorf("账号中心查询 credential 失败(account=%d)，回退老路: %v", ident.AccountId, err)
		}
		// NotFound：该账号没有密码（仅微信/验证码登录），密码登录不适用 → 回退老路
		return nil, false, nil
	}
	if !common.ValidatePasswordAndHash(password, cred.PasswordHash) {
		return nil, false, errors.New("用户名或密码错误，或用户已被封禁")
	}

	// 3) account_id → parvis 本地 user。
	var ap AccountProduct
	err := ACCOUNT_DB.Where("account_id = ? AND product_code = ?", ident.AccountId, ProductCodeParvis).
		First(&ap).Error
	if err != nil {
		// 账号存在但在 parvis 无映射：理论上迁移后不会发生（每个迁移用户都有 parvis 映射）。
		// 多产品阶段这里是 JIT 开通点；本期单产品先回退老路，记日志便于排查。
		logger.SysErrorf("账号中心命中但缺 parvis 映射(account=%d)，回退老路: %v", ident.AccountId, err)
		return nil, false, nil
	}

	var u User
	if err := DB.First(&u, "id = ?", ap.LocalUserId).Error; err != nil {
		return nil, false, nil // 本地用户查不到 → 回退老路
	}
	if u.Status != UserStatusEnabled {
		return nil, false, errors.New("用户名或密码错误，或用户已被封禁")
	}
	return &u, true, nil
}

// ValidateAccountPasswordByLocalUserID 用账号中心 credential 校验密码。
//
// 用于「已知 local_user_id、需二次确认密码」的场景（企业管理操作、敏感操作前置）：
// 调用方拿到 user 后，传 user.Id + 用户输入密码进来即可。
//
//   - 账号中心未启用 / 用户未投影 / 账号中心 credential 缺失 → 返回 (false, ErrFallback)，
//     调用方应回退到 users.password 校验（阶段 2 双写期间兜底）。
//   - 账号中心命中且密码对 → (true, nil)
//   - 账号中心命中但密码错 → (false, nil)，调用方直接判负，不回退（避免老路给出不一致结果）。
//
// 阶段 2 单源化后，users.password 列将停写；届时本函数取代所有 ValidatePasswordAndHash
// (input, user.Password) 的直读 users 写法。
var ErrFallbackToLegacyPassword = errors.New("账号中心无法校验密码，请回退老路")

func ValidateAccountPasswordByLocalUserID(localUserID int, plainPassword string) (bool, error) {
	if ACCOUNT_DB == nil {
		return false, ErrFallbackToLegacyPassword
	}
	if localUserID == 0 || plainPassword == "" {
		return false, errors.New("local_user_id / password 不能为空")
	}
	var ap AccountProduct
	err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?", ProductCodeParvis, int64(localUserID)).
		First(&ap).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, ErrFallbackToLegacyPassword
	}
	if err != nil {
		logger.SysErrorf("账号中心 ValidateAccountPasswordByLocalUserID 查映射失败 user=%d: %v", localUserID, err)
		return false, ErrFallbackToLegacyPassword
	}
	var cred AccountCredential
	if err := ACCOUNT_DB.First(&cred, "account_id = ?", ap.AccountId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, ErrFallbackToLegacyPassword
		}
		logger.SysErrorf("账号中心 ValidateAccountPasswordByLocalUserID 查 credential 失败 account=%d: %v",
			ap.AccountId, err)
		return false, ErrFallbackToLegacyPassword
	}
	return common.ValidatePasswordAndHash(plainPassword, cred.PasswordHash), nil
}
