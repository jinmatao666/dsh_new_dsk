package model

import (
	"github.com/songquanpeng/one-api/common/logger"
)

// MigrateAccountsV0 把 one-api.users 的历史用户迁移到账号中心（account_center）。
//
// 动作（详见 docs/plans/2026-06-02-unified-account-center-design.md §5）：
//   - 为每个未投影用户（account_products 中无 parvis 映射）生成雪花 account_id；
//   - accounts / account_credentials / account_identifiers / account_products 各落库；
//   - 对齐 users.account_id 作兼容字段。
//
// 幂等：以「account_products 中是否已有 (parvis, local_user_id) 映射」为待迁移判据,
// 已投影行跳过；重复执行安全。
//
// 为何不再用 users.account_id IS NULL 判据：历史投影曾把 users.account_id 与
// account_products 映射写脱节(两套 account_id),用 users.account_id 判「已迁移」会
// 误判——真实投影状态只看 account_products(identifier 写入也以它为准)。
//
// 跨库：users 在主库 DB，账号中心在 ACCOUNT_DB，无法用单一事务，故按「先写账号库、
// 后对齐 account_id」的顺序，并对账号库写入用 OnConflict DoNothing 兜底重复执行。
//
// 大表保护：按 id 游标分页（每批 migrationBatchSize），避免全量 Find 把几十万行
// 一次拉进内存。批级错误返回 error；per-user 错误记日志后继续，不阻塞整体迁移。
func MigrateAccountsV0() error {
	if ACCOUNT_DB == nil {
		logger.SysLog("账号中心未启用（ACCOUNT_SQL_DSN 未配置），跳过 MigrateAccountsV0")
		return nil
	}

	migrated, failed := 0, 0
	var lastID int = 0
	for {
		var users []User
		// 扫描所有有效用户(不再按 account_id IS NULL 过滤),逐批用 account_products
		// 映射判断是否已投影,只投影无映射者。占位 username(acc_<ts>_<rand>)的处理同前:
		// 已投影用户被跳过,不会被 EnsureAccountForUser 当受管 username 覆盖真实标识。
		err := DB.Where("status != ? AND id > ?", UserStatusDeleted, lastID).
			Order("id asc").Limit(migrationBatchSize).Find(&users).Error
		if err != nil {
			return err
		}
		if len(users) == 0 {
			break
		}
		// 批量查这批用户已有的 parvis 映射,杜绝 per-user N+1。
		batchIDs := make([]int, 0, len(users))
		for i := range users {
			batchIDs = append(batchIDs, users[i].Id)
		}
		projected := ResolveAccountIDsByLocalUsers(batchIDs)
		for i := range users {
			lastID = users[i].Id
			if _, ok := projected[users[i].Id]; ok {
				continue // 已有 account_products 映射 = 已投影,跳过。
			}
			if _, err := EnsureAccountForUser(&users[i]); err != nil {
				failed++
				logger.SysErrorf("accounts migration v0: 用户 %d 迁移失败: %v", users[i].Id, err)
			} else {
				migrated++
			}
		}
	}

	if migrated == 0 && failed == 0 {
		return nil
	}
	logger.SysLogf("accounts migration v0: 完成，成功 %d，失败 %d", migrated, failed)
	return nil
}

// migrationBatchSize 单次扫描的 users 行数。500 是经验值：足够小不会一次性占满
// 内存，又足够大让查询效率不被来回往返抵消。如未来改为大表迁移密集场景，可调高。
const migrationBatchSize = 500

// CountUnmigratedUsers 统计仍未投影到账号中心的有效用户数。
// 启动期断言用：单源化后 users 身份字段停写，未迁移用户没法登录，启动时必须 == 0。
//
// 判据以 account_products 映射为准(不读 users.account_id):有效用户总数 - 已有
// parvis 映射的用户数。跨库无法 JOIN,故分页扫 users 后批量查映射做差。
func CountUnmigratedUsers() (int64, error) {
	if ACCOUNT_DB == nil {
		return 0, nil
	}
	var unmigrated int64
	var lastID int = 0
	for {
		var users []User
		err := DB.Select("id").Where("status != ? AND id > ?", UserStatusDeleted, lastID).
			Order("id asc").Limit(migrationBatchSize).Find(&users).Error
		if err != nil {
			return 0, err
		}
		if len(users) == 0 {
			break
		}
		batchIDs := make([]int, 0, len(users))
		for i := range users {
			batchIDs = append(batchIDs, users[i].Id)
			lastID = users[i].Id
		}
		projected := ResolveAccountIDsByLocalUsers(batchIDs)
		for _, id := range batchIDs {
			if _, ok := projected[id]; !ok {
				unmigrated++
			}
		}
	}
	return unmigrated, nil
}

// mapUserStatusToAccount 把 users.status 三态一一映射到账号中心三态。
//   - Enabled → AccountStatusEnabled
//   - Disabled → AccountStatusDisabled
//   - Deleted → AccountStatusDeleted（注销，与 disabled 在跨产品判断上语义不同）
//
// 未知值兜底 disabled，避免误把异常值当正常账号放行。
func mapUserStatusToAccount(userStatus int) int {
	switch userStatus {
	case UserStatusEnabled:
		return AccountStatusEnabled
	case UserStatusDeleted:
		return AccountStatusDeleted
	default:
		return AccountStatusDisabled
	}
}
