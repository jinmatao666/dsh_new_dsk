package model

import (
	"errors"

	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 全局档案（B 类：昵称/头像）的唯一访问模块。
//
// 「库可换」铁律：对账号库的访问全部收口在 account_*.go 这几个文件里，业务层只调这里的
// 函数，绝不直接碰 ACCOUNT_DB、绝不跨库 JOIN/事务。将来账号中心换库或变成远程服务，
// 只需替换本模块实现，业务层零改动。
//
// 写入唯一入口：UpdateAccountProfile。各产品要改昵称/头像，必须调它（经 account_id），
// 不得改自己业务表里的副本——因为路线 A 读穿下产品本地根本不存这份数据。

var ErrAccountCenterDisabled = errors.New("账号中心未启用")

// GetAccountProfile 读穿：按 account_id 取全局档案。账号中心未启用返回 ErrAccountCenterDisabled。
// 档案行不存在返回 (nil, nil)——调用方据此回退展示（如用本地 display_name 兜底）。
func GetAccountProfile(accountID int64) (*AccountProfile, error) {
	if ACCOUNT_DB == nil {
		return nil, ErrAccountCenterDisabled
	}
	var p AccountProfile
	err := ACCOUNT_DB.First(&p, "account_id = ?", accountID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// GetAccountProfiles 批量读穿，供列表场景一次取多个账号的档案，避免 N 次单查。
// 返回 map[account_id]*AccountProfile，缺档案的 account_id 不在 map 中。
func GetAccountProfiles(accountIDs []int64) (map[int64]*AccountProfile, error) {
	out := make(map[int64]*AccountProfile, len(accountIDs))
	if ACCOUNT_DB == nil || len(accountIDs) == 0 {
		return out, nil
	}
	var rows []AccountProfile
	if err := ACCOUNT_DB.Where("account_id IN ?", accountIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].AccountId] = &rows[i]
	}
	return out, nil
}

// UpdateAccountProfile 写入唯一收口点：upsert 全局档案。空字符串表示「不修改该字段」，
// 避免误把昵称/头像清空（要清空请用专门的清除语义，本期不开放）。
func UpdateAccountProfile(accountID int64, displayName, avatarURL string) error {
	if ACCOUNT_DB == nil {
		return ErrAccountCenterDisabled
	}
	if accountID == 0 {
		return errors.New("account_id 为空")
	}

	updates := map[string]any{}
	if displayName != "" {
		updates["display_name"] = displayName
	}
	if avatarURL != "" {
		updates["avatar_url"] = avatarURL
	}
	if len(updates) == 0 {
		return nil
	}

	profile := AccountProfile{AccountId: accountID, DisplayName: displayName, AvatarURL: avatarURL}
	return ACCOUNT_DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "account_id"}},
		DoUpdates: clause.Assignments(updates),
	}).Create(&profile).Error
}

// SyncAccountProfileByUserID 业务层调用入口：按本地 user id 反查 account_id 后写档案。
// 「失败不阻断」语义：账号中心未启用 / 用户尚未投影 / 写入失败都只记日志，调用方主流程继续。
//
// 与 EnsureAccountForUser 的边界：EnsureAccountForUser 对 profile 用 DoNothing 仅做「首次播种」，
// 此后档案的所有更新都必须经此函数（或 UpdateAccountProfile），保证账号中心是 display_name
// 唯一权威写入源，不被 users 旧值回冲。
func SyncAccountProfileByUserID(localUserID int, displayName, avatarURL, scene string) {
	if ACCOUNT_DB == nil || localUserID == 0 {
		return
	}
	if displayName == "" && avatarURL == "" {
		return
	}
	var ap AccountProduct
	err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?", ProductCodeParvis, int64(localUserID)).
		First(&ap).Error
	if err != nil {
		// 用户尚未投影到账号中心（首次注册的双写还没跑或失败），下次同步会兜底。
		return
	}
	if err := UpdateAccountProfile(ap.AccountId, displayName, avatarURL); err != nil &&
		!errors.Is(err, ErrAccountCenterDisabled) {
		logger.SysErrorf("账号中心同步档案失败(scene=%s, user=%d, account=%d): %v",
			scene, localUserID, ap.AccountId, err)
	}
}
