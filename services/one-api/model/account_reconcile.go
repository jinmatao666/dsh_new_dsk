package model

import (
	"fmt"

	"github.com/songquanpeng/one-api/common/logger"
)

// AccountReconcileReport 账号中心与 users 表的一致性核对结果（只读，零副作用）。
type AccountReconcileReport struct {
	TotalUsers         int64    // users 表有效用户数（未注销）
	Projected          int64    // 已投影到账号中心（account_products 中有 parvis 映射）
	Unprojected        int64    // 尚未投影（account_products 中无映射）
	MissingAccount     int64    // 有映射但账号中心查无 accounts 行
	MissingProduct     int64    // 占位(映射即来自 account_products,理论恒为 0,保留字段兼容)
	IdentifierMismatch int64    // 受管标识(username/phone/wechat/email)与账号中心不一致
	Samples            []string // 前若干条异常样例,便于排查
}

// ReconcileAccounts 只读核对 users 与账号中心的一致性,不写任何库。
// 用于在推进 S6(停写旧列)前,用真实数据判断账号中心是否可信。
//
// 投影判据以 account_products 映射为准(不读 users.account_id):历史上两套 account_id
// 曾脱节,只有 account_products 反映真实投影状态(identifier 写入也以它定位账号)。
func ReconcileAccounts() (*AccountReconcileReport, error) {
	if ACCOUNT_DB == nil {
		return nil, ErrAccountCenterDisabled
	}
	r := &AccountReconcileReport{}

	if err := DB.Model(&User{}).Where("status != ?", UserStatusDeleted).Count(&r.TotalUsers).Error; err != nil {
		return nil, err
	}

	// 逐个有效用户核对:以 account_products 映射判断是否已投影,再核对账号行与受管标识。
	// 分页扫描避免一次性载入。
	const pageSize = 500
	var lastID int = 0
	addSample := func(s string) {
		if len(r.Samples) < 50 {
			r.Samples = append(r.Samples, s)
		}
	}
	for {
		var users []User
		err := DB.Where("status != ? AND id > ?", UserStatusDeleted, lastID).
			Order("id asc").Limit(pageSize).Find(&users).Error
		if err != nil {
			return nil, err
		}
		if len(users) == 0 {
			break
		}
		batchIDs := make([]int, 0, len(users))
		for i := range users {
			batchIDs = append(batchIDs, users[i].Id)
		}
		projected := ResolveAccountIDsByLocalUsers(batchIDs)
		for i := range users {
			u := &users[i]
			lastID = u.Id
			accID, ok := projected[u.Id]
			if !ok || accID == 0 {
				r.Unprojected++
				continue // 无 account_products 映射 = 未投影。
			}
			r.Projected++

			var accCount int64
			ACCOUNT_DB.Model(&Account{}).Where("id = ?", accID).Count(&accCount)
			if accCount == 0 {
				r.MissingAccount++
				addSample(fmt.Sprintf("user=%d account=%d 缺 accounts 行", u.Id, accID))
				continue
			}

			// 注:accID 即来自 account_products 映射,故无需再核 parvis 映射存在性
			// (MissingProduct 恒为 0,保留字段仅为兼容报表)。

			if !managedIdentifiersMatch(accID, u) {
				r.IdentifierMismatch++
				addSample(fmt.Sprintf("user=%d account=%d 受管标识不一致", u.Id, accID))
			}
		}
	}

	logger.SysLogf("账号中心核对: 总计 %d, 已投影 %d, 未投影 %d, 缺账号 %d, 缺映射 %d, 标识不一致 %d",
		r.TotalUsers, r.Projected, r.Unprojected, r.MissingAccount, r.MissingProduct, r.IdentifierMismatch)
	return r, nil
}

// managedIdentifiersMatch 核对受管标识(username/phone/wechat)在账号中心是否与 users 完全一致。
func managedIdentifiersMatch(accID int64, u *User) bool {
	var rows []AccountIdentifier
	if err := ACCOUNT_DB.Where("account_id = ? AND type IN ?", accID,
		[]string{IdentifierTypeUsername, IdentifierTypePhone, IdentifierTypeWeChat, IdentifierTypeEmail}).Find(&rows).Error; err != nil {
		return false
	}
	have := map[string]string{}
	for _, row := range rows {
		have[row.Type] = row.Identifier
	}
	want := map[string]string{}
	if u.Username != "" {
		want[IdentifierTypeUsername] = u.Username
	}
	if u.Phone != "" {
		want[IdentifierTypePhone] = u.Phone
	}
	if u.WeChatId != "" {
		want[IdentifierTypeWeChat] = u.WeChatId
	}
	if u.Email != "" {
		want[IdentifierTypeEmail] = u.Email
	}
	if len(have) != len(want) {
		return false
	}
	for k, v := range want {
		if have[k] != v {
			return false
		}
	}
	return true
}
