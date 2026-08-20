package model

import (
	"context"
	"errors"
	"fmt"

	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/songquanpeng/one-api/common/snowflake"
)

// JIT (Just-In-Time Provisioning) 通用入口。
//
// 用途：让任何登录方式（OAuth/手机号验证码/邮箱注册等）在「账号已存在则登录、不存在则
// 自动开通」时复用同一套逻辑，不再各自写一遍 IsXxxAlreadyTaken+FillUserByXxx+Insert。
//
// 语义：
//   - 输入「登录方式 + identifier 值」，例如 (IdentifierTypeWeChat, "wx_unionid_xxx")。
//   - 命中：从 account_identifiers 拿到 account_id，从 account_products 拿到本地 users.id，
//     载入 users 业务记录返回。
//   - 未命中：通过 User.Insert 触发 EnsureAccountForUser 建好 account + 映射 + 空 identifier，
//     然后 JIT 显式写真正的 (type, identifier) 行。最后 cleanup 占位 username 标识。
//
// 与 EnsureAccountForUser 的边界：
//   - EnsureAccountForUser 走「users 镜像→账号中心」方向，对受管类型先删后建。
//     JIT 必须在 Insert 完成（含 EnsureAccountForUser 跑完）之后再写 identifier，否则
//     会被 EnsureAccountForUser 按 users 空值删除。
//   - JIT 走「账号中心→users 投影」方向，是 S6 单源化后的注册入口。
//
// 设计 §7.3「JIT 自动开通」+ §S6 单源化前置条件。
type JITRequest struct {
	Type       string // IdentifierTypeWeChat / IdentifierTypePhone / ...
	Identifier string // 实际值
	Verified   bool   // OAuth / 验证码登录通常 true
	// DisplayName 仅用于「未命中、新建 users」的展示初值；命中已有用户时忽略。
	// 走 SyncAccountProfileByUserID 落到 account_profiles，不写 users.display_name。
	DisplayName string
	// InviterId 仅未命中时生效；命中已有用户忽略邀请码奖励。
	InviterId int
}

// JITResolveOrCreate 是 JIT 的核心入口。返回 (user, created, err)：
//   - created=true 表示新建了账号 + 本地 users 记录；调用方可据此区分「首次登录」事件。
//   - created=false 表示命中已有账号；user 是载入的 parvis 本地业务记录。
//   - err != nil：账号库或业务库写入失败，调用方应中断登录流程并报错。
//
// 失败语义与双写不同：JIT 是注册主流程的一部分，账号库失败不能静默吞掉，必须返回错误，
// 否则会出现「账号建了一半、本地 users 没建」或反过来的孤儿状态。
func JITResolveOrCreate(ctx context.Context, req JITRequest) (*User, bool, error) {
	if ACCOUNT_DB == nil {
		return nil, false, errors.New("账号中心未启用，JIT 不可用")
	}
	if req.Type == "" || req.Identifier == "" {
		return nil, false, errors.New("JIT: type/identifier 不能为空")
	}

	// 1) 命中路径：account_identifiers → account_products → users
	if u, ok, err := jitTryResolve(req.Type, req.Identifier); err != nil {
		return nil, false, err
	} else if ok {
		return u, false, nil
	}

	// 2) 未命中路径：让 User.Insert 走完标准副作用 + EnsureAccountForUser 建 account + 映射，
	//    然后 JIT 显式写真正的 identifier 行（顺序至关重要：必须在 EnsureAccountForUser 之后，
	//    否则受管类型「先删后建」会按 users 空值把 identifier 删掉）。
	//
	//    占位 username：users.username 有唯一索引，空字符串在 MySQL 下不允许多行并存，
	//    故用「jit_<snowflake>」占位，保证全局唯一且可追溯。真正的 username 在阶段 6
	//    单源化后由账号中心持有，users.username 届时停写。
	tempAccID := snowflake.NextID() // 仅用于占位 username，与最终 accID 无关
	placeholderUsername := fmt.Sprintf("jit_%d", tempAccID)
	newUser := &User{
		Username: placeholderUsername,
		Status:   UserStatusEnabled,
	}
	if err := newUser.Insert(ctx, req.InviterId); err != nil {
		return nil, false, fmt.Errorf("JIT: 本地 users 建失败: %w", err)
	}

	// Insert 末尾会触发 SyncAccountForUser → EnsureAccountForUser，回填 newUser.AccountId。
	// 若 EnsureAccountForUser 因副本失败而未回填（失败不阻断），AccountId 仍为 nil，此处必须报错——
	// 否则后续写不进 identifier，整体卡死。
	if newUser.AccountId == nil || *newUser.AccountId == 0 {
		return nil, false, errors.New("JIT: User.Insert 后账号中心未回填 account_id（疑似账号库故障）")
	}
	accID := *newUser.AccountId

	// EnsureAccountForUser 会按 users.Username 镜像写一条 type=username 的 identifier，
	// 但 JIT 占位 username 不是真身份，必须立即清掉，避免污染账号中心。
	// （阶段 6 单源化后会有专门的 username 注册入口，那时不再有占位逻辑。）
	if err := ACCOUNT_DB.Where("account_id = ? AND type = ?", accID, IdentifierTypeUsername).
		Delete(&AccountIdentifier{}).Error; err != nil {
		logger.SysErrorf("JIT: 清理占位 username 标识失败 account=%d: %v", accID, err)
	}

	// 写真正的 identifier；这一步必须在 EnsureAccountForUser 跑完之后才能执行。
	// 失败/撞键路径必须回滚已建的 users + account + 映射，否则会残留孤儿账号。
	newIdent := AccountIdentifier{
		Id:         snowflake.NextID(),
		AccountId:  accID,
		Type:       req.Type,
		Identifier: req.Identifier,
		Verified:   req.Verified,
	}
	if err := ACCOUNT_DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&newIdent).Error; err != nil {
		jitRollbackProvision(newUser.Id, accID, "identifier 写入失败")
		return nil, false, fmt.Errorf("JIT: 写 identifier 失败 account=%d %s/%s: %w",
			accID, req.Type, req.Identifier, err)
	}
	// 校验是否真的写进去了（DoNothing 撞键时 RowsAffected=0，identifier 已绑别的账号）。
	var n int64
	ACCOUNT_DB.Model(&AccountIdentifier{}).
		Where("account_id = ? AND type = ? AND identifier = ?", accID, req.Type, req.Identifier).
		Count(&n)
	if n == 0 {
		jitRollbackProvision(newUser.Id, accID, "identifier 已被其他账号占用")
		return nil, false, fmt.Errorf("JIT: identifier %s/%s 已被其他账号占用", req.Type, req.Identifier)
	}

	if req.DisplayName != "" {
		// display_name 走 B 类档案写收口；失败不阻断 JIT（注册主流程已成功）。
		SyncAccountProfileByUserID(newUser.Id, req.DisplayName, "", "jit_provision")
	}

	return newUser, true, nil
}

// jitTryResolve 抽出命中分支：identifier → account_products → users。
// 返回 (user, true, nil) 命中；(nil, false, nil) 未命中；(nil, false, err) 异常。
func jitTryResolve(typ, identifier string) (*User, bool, error) {
	var ident AccountIdentifier
	err := ACCOUNT_DB.Where("type = ? AND identifier = ?", typ, identifier).First(&ident).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("JIT: 查 account_identifiers 失败: %w", err)
	}

	var ap AccountProduct
	err = ACCOUNT_DB.Where("account_id = ? AND product_code = ?", ident.AccountId, ProductCodeParvis).
		First(&ap).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// identifier 已绑账号但 parvis 没映射 —— 多产品阶段是首次开通点；本期单产品
		// 视为数据漂移，报错让人工介入而非静默新建第二个账号。
		return nil, false, fmt.Errorf("JIT: account=%d 在账号中心存在但 parvis 无本地映射，疑似数据漂移", ident.AccountId)
	}
	if err != nil {
		return nil, false, fmt.Errorf("JIT: 查 account_products 失败: %w", err)
	}

	var u User
	if err := DB.First(&u, "id = ?", ap.LocalUserId).Error; err != nil {
		return nil, false, fmt.Errorf("JIT: identifier 命中但本地用户缺失(account=%d, local=%d): %w",
			ident.AccountId, ap.LocalUserId, err)
	}
	return &u, true, nil
}

// jitRollbackProvision 未命中路径里 identifier 写入失败/撞键时的补偿回滚。
//
// User.Insert 已建好 users 行 + account + product 映射 + 占位 identifier，调用方此时若不
// 回滚，会留下「无任何真身份的孤儿账号 + 无登录方式的本地用户」，对账号中心 / users 都是
// 数据漂移；下次同号重试 JIT 也会因 product_code+local_user_id 已存在而误复用孤儿。
//
// 回滚顺序与 EnsureAccountForUser 建立顺序相反：
//  1. 删 account_identifiers（占位 username 已被前面清过，但 EnsureAccountForUser 也可能
//     补写过 phone/wechat 等受管类型，这里清空兜底）
//  2. 删 account_credentials（首次 JIT 通常没密码，但若上层带 password 也得清）
//  3. 删 account_profiles
//  4. 删 account_products（这一步在删 accounts 前做，否则外键/级联策略不一时会留垃圾）
//  5. 删 accounts
//  6. 物理删 users 行（JIT 刚建出来，没有任何资产/积分/订单引用，物理删安全）
//
// 任何一步失败只记日志、继续执行剩余步骤——回滚是补救路径，目标是尽量清干净，绝不再向上抛错。
func jitRollbackProvision(localUserID int, accID int64, reason string) {
	logger.SysErrorf("JIT 回滚 user=%d account=%d 原因=%s", localUserID, accID, reason)
	if ACCOUNT_DB != nil && accID != 0 {
		if err := ACCOUNT_DB.Where("account_id = ?", accID).Delete(&AccountIdentifier{}).Error; err != nil {
			logger.SysErrorf("JIT 回滚清 identifiers 失败 account=%d: %v", accID, err)
		}
		if err := ACCOUNT_DB.Where("account_id = ?", accID).Delete(&AccountCredential{}).Error; err != nil {
			logger.SysErrorf("JIT 回滚清 credentials 失败 account=%d: %v", accID, err)
		}
		if err := ACCOUNT_DB.Where("account_id = ?", accID).Delete(&AccountProfile{}).Error; err != nil {
			logger.SysErrorf("JIT 回滚清 profiles 失败 account=%d: %v", accID, err)
		}
		if err := ACCOUNT_DB.Where("account_id = ?", accID).Delete(&AccountProduct{}).Error; err != nil {
			logger.SysErrorf("JIT 回滚清 products 失败 account=%d: %v", accID, err)
		}
		if err := ACCOUNT_DB.Where("id = ?", accID).Delete(&Account{}).Error; err != nil {
			logger.SysErrorf("JIT 回滚清 accounts 失败 account=%d: %v", accID, err)
		}
	}
	if localUserID != 0 {
		// 物理删 JIT 新建的 users 行：刚建出来,无任何业务资产引用,直接 Unscoped 删掉。
		// 不能走 user.Delete()(软删 + 标 deleted_),因为软删行仍占 username/access_token/aff_code
		// 唯一键,会让用户用同身份重试 JIT 时撞键。
		if err := DB.Unscoped().Where("id = ?", localUserID).Delete(&User{}).Error; err != nil {
			logger.SysErrorf("JIT 回滚物理删 users 失败 user=%d: %v", localUserID, err)
		}
	}
}

// 无用引用，避免 logger 在某些组合下被认为未使用。
var _ = logger.SysLog
