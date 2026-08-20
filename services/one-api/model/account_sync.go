package model

import (
	"errors"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/snowflake"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// EnsureAccountForUser 幂等地把一个 Parvis 本地用户「投影」到账号中心，是阶段 A 双写的核心。
//
// 适用场景：注册成功、绑手机、绑微信、改密等任何会改变用户身份字段的写入点，
// 在写完 users 表后调用本函数，使账号中心持续与 users 保持一致。
//
// 语义：
//   - account：不存在则建，存在则保留（DoNothing）。
//   - credential：按当前 user.Password 做 upsert（改密会刷新 hash）。
//   - identifiers：受管类型（username/phone/wechat/email,阶段 3 起 email 也是受管）镜像
//     users 当前值（先删后建，换绑/解绑不残留旧值）；历史类型（github/lark/oidc）仅追加。
//   - product：确保 (account_id, parvis, users.id) 映射存在。
//   - 回填 users.account_id。
//
// 失败处理：调用方应「记日志不阻断主流程」——账号中心是副本，短暂落后可由下次写入或
// 兜底迁移补齐，绝不能因为副本写失败而让用户主流程（注册/登录）失败。
func EnsureAccountForUser(u *User) (int64, error) {
	if ACCOUNT_DB == nil {
		return 0, nil // 账号中心未启用
	}

	// 决定本次投影使用的 accID。权威来源优先级（单源化修复后）：
	//   1) 账号库已有的 (parvis, local_user_id) 映射 —— 唯一权威。identifier 写入
	//      (writeManagedIdentifierByLocalUser)也按此映射定位账号,投影必须同源,
	//      否则会分裂出两套 account_id(users.account_id 一套、account_products 一套),
	//      导致「手机号写进 A 账号、读取查 B 账号」的绑定死循环。
	//   2) 内存里的 u.AccountId(无映射的首次投影,如新注册用户尚未建映射)。
	//   3) 都没有 → 生成新雪花 ID(首次投影)。
	//
	// 为什么映射优先于 u.AccountId：本函数是「账号库事务 + 回填 users.account_id」两段式,
	// 若账号库事务成功、回填失败,users.account_id 会与映射脱节(历史脏数据即如此)。
	// 以账号库映射为首选可彻底消除此类分裂,且对已投影用户绝不重复 NextID() 建号。
	accID := int64(0)
	var existing AccountProduct
	err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?", ProductCodeParvis, int64(u.Id)).
		First(&existing).Error
	if err == nil {
		accID = existing.AccountId // 账号库已认得这个本地用户,复用,绝不另建
	} else if u.AccountId != nil && *u.AccountId != 0 {
		accID = *u.AccountId
	} else {
		accID = snowflake.NextID()
	}

	err = ACCOUNT_DB.Transaction(func(tx *gorm.DB) error {
		acc := Account{Id: accID, Status: mapUserStatusToAccount(u.Status)}
		// status 必须随 users.status 持续刷新，否则禁用/启用变更不会进账号中心。
		// updated_at 也同步刷新，便于排查最近一次同步时间。
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"status", "updated_at"}),
		}).Create(&acc).Error; err != nil {
			return err
		}

		if u.Password != "" {
			cred := AccountCredential{AccountId: accID, PasswordHash: u.Password}
			// 改密路径：account_id 撞键时刷新 password_hash。
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "account_id"}},
				DoUpdates: clause.AssignmentColumns([]string{"password_hash", "updated_at"}),
			}).Create(&cred).Error; err != nil {
				return err
			}
		}

		// 身份标识同步分两类处理：
		//  - 受管类型（username/phone/wechat/email）：账号中心须「镜像」users 当前值。
		//    换绑/解绑会改变这些字段，故先删本账号该类型所有行，再按当前非空值重建，
		//    保证不残留旧值。email 阶段 3 改为受管（丢履历，原追记型语义见设计 §S6 决策）。
		//  - 历史类型（github/lark/oidc）：仅迁移时追加，本期不在此 reconcile，
		//    避免一次手机换绑误删历史绑定。
		managed := map[string]string{
			IdentifierTypeUsername: u.Username,
			IdentifierTypePhone:    u.Phone,
			IdentifierTypeWeChat:   u.WeChatId,
			IdentifierTypeEmail:    u.Email,
		}
		for typ := range managed {
			if err := tx.Where("account_id = ? AND type = ?", accID, typ).
				Delete(&AccountIdentifier{}).Error; err != nil {
				return err
			}
		}
		var idents []AccountIdentifier
		addIdent := func(typ, id string, verified bool) {
			if id == "" {
				return
			}
			idents = append(idents, AccountIdentifier{
				Id: snowflake.NextID(), AccountId: accID, Type: typ, Identifier: id, Verified: verified,
			})
		}
		addIdent(IdentifierTypeUsername, u.Username, true)
		addIdent(IdentifierTypePhone, u.Phone, u.PhoneVerified)
		addIdent(IdentifierTypeWeChat, u.WeChatId, true)
		addIdent(IdentifierTypeEmail, u.Email, u.Email != "")
		// 历史类型仅当尚不存在时追加（DoNothing 兜底）。
		addIdent(IdentifierTypeGitHub, u.GitHubId, true)
		addIdent(IdentifierTypeLark, u.LarkId, true)
		addIdent(IdentifierTypeOidc, u.OidcId, true)
		if len(idents) > 0 {
			// uk_type_identifier 撞键说明该标识已绑别的账号（历史脏数据/并发），
			// DoNothing 跳过，留待人工裁决，不阻塞同步。
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&idents).Error; err != nil {
				return err
			}
		}

		ap := AccountProduct{
			AccountId:   accID,
			ProductCode: ProductCodeParvis,
			LocalUserId: int64(u.Id),
			Status:      AccountStatusEnabled,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ap).Error; err != nil {
			return err
		}

		// 全局档案（B 类）：用 users.display_name 播种。仅当档案行尚不存在时写入
		// （DoNothing），此后账号中心是档案唯一写入源，双写不再覆盖它，避免把用户在
		// 账号中心改过的昵称又被 users 旧值回冲。
		if u.DisplayName != "" {
			profile := AccountProfile{AccountId: accID, DisplayName: u.DisplayName}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&profile).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}

	// 对齐写 users.account_id：单源化后该列不再是逻辑权威(读取/查重/控制面均以
	// account_products 映射为准),但仍保留写入作兼容与可观测。改为「与真实 accID 不一致
	// 就纠正」,可顺带修复历史分裂的存量行(users.account_id 曾与映射脱节)。
	if u.AccountId == nil || *u.AccountId != accID {
		if err := DB.Model(&User{}).
			Where("id = ?", u.Id).
			Update("account_id", accID).Error; err != nil {
			return 0, err
		}
		u.AccountId = &accID
	}
	return accID, nil
}

// SyncAccountForUser 是 EnsureAccountForUser 的「失败不阻断」包装，供写入点直接调用。
// 账号中心未启用或同步失败都只记日志，绝不影响调用方主流程。
func SyncAccountForUser(u *User, scene string) {
	if ACCOUNT_DB == nil {
		return
	}
	if _, err := EnsureAccountForUser(u); err != nil {
		logger.SysErrorf("账号中心双写失败(scene=%s, user=%d): %v", scene, u.Id, err)
	}
}

// SyncAccountByUserID 按 user id 重新载入完整行后再投影到账号中心。
// 用于 User.Update 等可能持有「部分字段结构体」的写入点：GORM 的 Updates 只写非零字段，
// 传入的 user 可能缺 Username/Phone/Status 等，直接投影会污染账号中心，故必须先 reload 全行。
//
// 单源化后的关键修复：阶段 6 启用账号中心时,User.Insert 把 users.username 写为 "acc_<ts>_<rand>"
// 占位串,phone/email/wechat 等列也置空（真实值只在账号中心 account_identifiers）。若直接拿
// reload 出来的 full 投影,EnsureAccountForUser 的「受管类型先删后建」会把账号中心的真实
// 标识替换为占位/空值——username 变 acc_xxx,phone/email/wechat 全部丢失。
//
// 故 reload 后必须用 OverlayUsersIdentity 把账号中心权威值覆盖回 full,再投影；这样
// EnsureAccountForUser 的同步对身份字段是「写入等价值」,不会破坏账号中心数据。
func SyncAccountByUserID(userID int, scene string) {
	if ACCOUNT_DB == nil || userID == 0 {
		return
	}
	var full User
	if err := DB.First(&full, "id = ?", userID).Error; err != nil {
		logger.SysErrorf("账号中心双写 reload 失败(scene=%s, user=%d): %v", scene, userID, err)
		return
	}
	// 用账号中心权威值覆盖 users 占位/空值,避免下面的投影把真实标识反向覆盖掉。
	OverlayUsersIdentity([]*User{&full})
	// 阶段 2 单源化关键修复：密码只由 WriteAccountCredentialByLocalUser / 注册路径写入,
	// users.password 列已停写(改密时不更新),reload 出来的是历史旧哈希。若把它带进
	// EnsureAccountForUser,第 68 行 `u.Password != ""` 会用旧哈希 upsert 覆盖刚写好的
	// 新密码 —— 表现为「改密后用新密码登录失败」。本函数只负责身份/状态对账,密码与它无关,
	// reload 后必须清空,让投影跳过 credential 写入。
	full.Password = ""
	if _, err := EnsureAccountForUser(&full); err != nil {
		logger.SysErrorf("账号中心双写失败(scene=%s, user=%d): %v", scene, userID, err)
	}
}

// DetachAccountForLocalUser 用户注销时清理账号中心：
//  1. 删受管 identifier 行（username/phone/wechat/email,阶段 3 起 email 也是受管类型）,
//     释放 uk_type_identifier 唯一键,避免「同号再注册」时新账号被旧标识占位卡死。
//     历史类型（github/lark/oidc）保留作履历,不在此清理。
//  2. accounts.status 标为 AccountStatusDeleted，保持账号中心状态与 users 注销态一致。
//  3. account_products 行保留：local_user_id 是注销前的本地用户 id，未来若开放「注销
//     后撤销」可再用；且删了它会让步骤 1 找不到 accID（以映射反查为权威）。
//
// 失败不阻断：账号中心是副本，注销若残留元数据由对账兜底。
func DetachAccountForLocalUser(localUserID int, scene string) {
	if ACCOUNT_DB == nil || localUserID == 0 {
		return
	}
	var ap AccountProduct
	err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?", ProductCodeParvis, int64(localUserID)).
		First(&ap).Error
	if err != nil {
		// 该用户从未投影过（账号中心后启用 / 早期未迁移），无需清理。
		return
	}
	accID := ap.AccountId

	if err := ACCOUNT_DB.Where("account_id = ? AND type IN ?", accID,
		[]string{IdentifierTypeUsername, IdentifierTypePhone, IdentifierTypeWeChat, IdentifierTypeEmail}).
		Delete(&AccountIdentifier{}).Error; err != nil {
		logger.SysErrorf("账号中心清理 identifier 失败(scene=%s, user=%d, account=%d): %v",
			scene, localUserID, accID, err)
	}
	if err := ACCOUNT_DB.Model(&Account{}).Where("id = ?", accID).
		Update("status", AccountStatusDeleted).Error; err != nil {
		logger.SysErrorf("账号中心标记注销失败(scene=%s, user=%d, account=%d): %v",
			scene, localUserID, accID, err)
	}
}

// hardDetachAccountForLocalUser 硬删除时物理清除账号中心该账号的全部数据。
//
// 与 DetachAccountForLocalUser（注销软删，仅清受管 identifier + 标记 status）不同：
// 这里把 account_identifiers（含历史 github/lark/oidc）、account_credentials、
// account_profiles、account_products、accounts 本行全部物理删除，不留任何痕迹。
//
// 经 account_products 反查 account_id；用户从未投影过则无需清理直接返回。
// 失败不阻断（账号中心是副本），仅记 SysError 日志。
func hardDetachAccountForLocalUser(localUserID int, scene string) {
	if ACCOUNT_DB == nil || localUserID == 0 {
		return
	}
	var ap AccountProduct
	if err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?",
		ProductCodeParvis, int64(localUserID)).First(&ap).Error; err != nil {
		// 该用户从未投影到账号中心，无需清理。
		return
	}
	accID := ap.AccountId
	err := ACCOUNT_DB.Transaction(func(tx *gorm.DB) error {
		// 该 account_id 下的全部登录标识（含历史 github/lark/oidc，硬删不保留履历）。
		if err := tx.Where("account_id = ?", accID).Delete(&AccountIdentifier{}).Error; err != nil {
			return err
		}
		if err := tx.Where("account_id = ?", accID).Delete(&AccountCredential{}).Error; err != nil {
			return err
		}
		if err := tx.Where("account_id = ?", accID).Delete(&AccountProfile{}).Error; err != nil {
			return err
		}
		// 删本产品映射行（按复合主键定位，避免误删同账号其他产品的映射）。
		if err := tx.Where("account_id = ? AND product_code = ?", accID, ProductCodeParvis).
			Delete(&AccountProduct{}).Error; err != nil {
			return err
		}
		// accounts 本行：仅当该账号已无任何产品映射时才删，避免删掉跨产品共享的账号。
		var remaining int64
		if err := tx.Model(&AccountProduct{}).Where("account_id = ?", accID).
			Count(&remaining).Error; err != nil {
			return err
		}
		if remaining == 0 {
			if err := tx.Where("id = ?", accID).Delete(&Account{}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		logger.SysErrorf("账号中心硬删除失败(scene=%s, user=%d, account=%d): %v",
			scene, localUserID, accID, err)
	}
}

// WriteAccountCredentialByLocalUser 阶段 2 单源化：把明文密码哈希后只写账号中心 credential，
// 不再 UPDATE users.password。调用方须保证传入的是明文（函数内统一哈希）。
//
// 适用场景：ResetUserPasswordByEmail 等所有「按用户改密」入口。User.Update / User.Insert
// 仍走 EnsureAccountForUser 的 credential upsert 路径（同样的哈希），二者写入结果等价。
//
// 账号中心未启用或用户未投影 → 退化为旧路径直写 users.password，保持灰度期间不破坏登录。
func WriteAccountCredentialByLocalUser(localUserID int, plainPassword string) error {
	if plainPassword == "" {
		return errors.New("password 为空")
	}
	hashed, err := common.Password2Hash(plainPassword)
	if err != nil {
		return err
	}
	if ACCOUNT_DB == nil {
		// 灰度未启用：回退旧路径直写 users.password。
		return DB.Model(&User{}).Where("id = ?", localUserID).Update("password", hashed).Error
	}
	var ap AccountProduct
	err = ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?", ProductCodeParvis, int64(localUserID)).
		First(&ap).Error
	if err != nil {
		// 该用户未投影到账号中心：回退旧路径直写 users.password，下次双写会补上。
		return DB.Model(&User{}).Where("id = ?", localUserID).Update("password", hashed).Error
	}
	cred := AccountCredential{AccountId: ap.AccountId, PasswordHash: hashed}
	if err := ACCOUNT_DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "account_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"password_hash", "updated_at"}),
	}).Create(&cred).Error; err != nil {
		return err
	}
	return nil
}

// WriteAccountIdentifierByLocalUser 阶段 4/5 单源化：按本地 user_id 写入受管标识
// (phone/wechat/email),账号中心是唯一权威。语义同 EnsureAccountForUser 的「先删后建」:
// 同账号同类型只保留一行。账号中心未启用或用户未投影时回退到对应 users 列。
//
// 调用方:UpdateUserPhone / OAuth 绑定/换绑等所有「直写身份字段」入口。
// 失败处理:返回 error 让调用方决定(注册类阻断、绑定类提示)。
func WriteAccountIdentifierByLocalUser(localUserID int, typ, identifier string, verified bool, scene string) error {
	return writeManagedIdentifierByLocalUser(localUserID, typ, identifier, verified, scene)
}

// ClearAccountIdentifierByLocalUser 公开版的清除入口,语义同 clearManagedIdentifierByLocalUser。
func ClearAccountIdentifierByLocalUser(localUserID int, typ, scene string) error {
	return clearManagedIdentifierByLocalUser(localUserID, typ, scene)
}

// writeManagedIdentifierByLocalUser 阶段 4/5 单源化：按本地 user_id 写入受管标识
// (phone/wechat/email),账号中心是唯一权威。语义同 EnsureAccountForUser 的「先删后建」:
// 同账号同类型只保留一行。账号中心未启用或用户未投影时回退到对应 users 列。
//
// 调用方:UpdateUserPhone / OAuth 绑定/换绑等所有「直写身份字段」入口。
// 失败处理:返回 error 让调用方决定(注册类阻断、绑定类提示)。
func writeManagedIdentifierByLocalUser(localUserID int, typ, identifier string, verified bool, scene string) error {
	if identifier == "" {
		return errors.New("identifier 为空")
	}
	if ACCOUNT_DB == nil {
		// 灰度未启用:回退老路直写 users 对应列,保持登录功能不破。
		return writeManagedIdentifierToUsersFallback(localUserID, typ, identifier, verified)
	}
	var ap AccountProduct
	if err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?",
		ProductCodeParvis, int64(localUserID)).First(&ap).Error; err != nil {
		// 用户未投影:fallback 写 users,等下次双写补齐。
		return writeManagedIdentifierToUsersFallback(localUserID, typ, identifier, verified)
	}
	accID := ap.AccountId
	return ACCOUNT_DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("account_id = ? AND type = ?", accID, typ).
			Delete(&AccountIdentifier{}).Error; err != nil {
			return err
		}
		ident := AccountIdentifier{
			Id: snowflake.NextID(), AccountId: accID,
			Type: typ, Identifier: identifier, Verified: verified,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ident).Error; err != nil {
			return err
		}
		return nil
	})
}

// clearManagedIdentifierByLocalUser 按本地 user_id 清除某受管标识(phone/wechat 解绑)。
// 账号中心未启用或用户未投影时回退到对应 users 列写空。
func clearManagedIdentifierByLocalUser(localUserID int, typ, scene string) error {
	if ACCOUNT_DB == nil {
		return clearManagedIdentifierFromUsersFallback(localUserID, typ)
	}
	var ap AccountProduct
	if err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?",
		ProductCodeParvis, int64(localUserID)).First(&ap).Error; err != nil {
		return clearManagedIdentifierFromUsersFallback(localUserID, typ)
	}
	if err := ACCOUNT_DB.Where("account_id = ? AND type = ?", ap.AccountId, typ).
		Delete(&AccountIdentifier{}).Error; err != nil {
		return err
	}
	return nil
}

// writeManagedIdentifierToUsersFallback 灰度未启用 / 未投影 fallback:直写 users 旧列。
func writeManagedIdentifierToUsersFallback(localUserID int, typ, identifier string, verified bool) error {
	updates := map[string]interface{}{}
	switch typ {
	case IdentifierTypePhone:
		updates["phone"] = identifier
		updates["phone_verified"] = verified
	case IdentifierTypeWeChat:
		updates["wechat_id"] = identifier
	case IdentifierTypeEmail:
		updates["email"] = identifier
	case IdentifierTypeUsername:
		updates["username"] = identifier
	case IdentifierTypeGitHub:
		updates["github_id"] = identifier
	case IdentifierTypeLark:
		updates["lark_id"] = identifier
	case IdentifierTypeOidc:
		updates["oidc_id"] = identifier
	default:
		return errors.New("不支持的 identifier 类型: " + typ)
	}
	return DB.Model(&User{}).Where("id = ?", localUserID).Updates(updates).Error
}

// clearManagedIdentifierFromUsersFallback 灰度未启用 fallback:清空 users 旧列。
func clearManagedIdentifierFromUsersFallback(localUserID int, typ string) error {
	updates := map[string]interface{}{}
	switch typ {
	case IdentifierTypePhone:
		updates["phone"] = ""
		updates["phone_verified"] = false
	case IdentifierTypeWeChat:
		updates["wechat_id"] = ""
	case IdentifierTypeGitHub:
		updates["github_id"] = ""
	case IdentifierTypeLark:
		updates["lark_id"] = ""
	case IdentifierTypeOidc:
		updates["oidc_id"] = ""
	default:
		return errors.New("不支持的 identifier 类型: " + typ)
	}
	return DB.Model(&User{}).Where("id = ?", localUserID).Updates(updates).Error
}
