package model

import "time"

// ExternalUserProvider 从账号中心数据库读取用户数据的实现
// 使用 ACCOUNT_DB 连接访问外部账号中心
type ExternalUserProvider struct{}

// NewExternalUserProvider 创建外部用户提供者实例
func NewExternalUserProvider() *ExternalUserProvider {
	return &ExternalUserProvider{}
}

// GetUserBasicInfo 获取用户基础信息
// 业务字段(status/account_type/created_at)以本地业务库 users 表为权威来源;
// 账号中心是规范化结构、无扁平 users 表,不能直接查 ACCOUNT_DB。
func (p *ExternalUserProvider) GetUserBasicInfo(userId int) (*UserBasicInfo, error) {
	var user User
	err := DB.Select("id", "username", "display_name", "email", "phone", "account_type", "created_at", "last_active_at", "status").
		Where("id = ?", userId).
		First(&user).Error
	if err != nil {
		return nil, err
	}

	return &UserBasicInfo{
		Id:           user.Id,
		Username:     user.Username,
		DisplayName:  user.DisplayName,
		Email:        user.Email,
		Phone:        user.Phone,
		AccountType:  user.AccountType,
		CreatedAt:    user.CreatedAt,
		LastActiveAt: user.LastActiveAt,
		Status:       user.Status,
	}, nil
}

// GetUsersByAccountType 根据账户类型获取用户列表
func (p *ExternalUserProvider) GetUsersByAccountType(accountType int, offset, limit int) ([]*UserBasicInfo, error) {
	var users []*User
	err := DB.Select("id", "account_id", "username", "display_name", "email", "phone", "account_type", "created_at", "last_active_at", "status").
		Where("account_type = ? AND status = ?", accountType, UserStatusEnabled).
		Order("id desc").
		Offset(offset).
		Limit(limit).
		Find(&users).Error
	if err != nil {
		return nil, err
	}

	OverlayUsersIdentity(users)
	return toUserBasicInfos(users), nil
}

// GetUsersByIds 批量获取用户信息
func (p *ExternalUserProvider) GetUsersByIds(userIds []int) ([]*UserBasicInfo, error) {
	if len(userIds) == 0 {
		return []*UserBasicInfo{}, nil
	}

	var users []*User
	err := DB.Select("id", "account_id", "username", "display_name", "email", "phone", "account_type", "created_at", "last_active_at", "status").
		Where("id IN ?", userIds).
		Find(&users).Error
	if err != nil {
		return nil, err
	}

	OverlayUsersIdentity(users)
	return toUserBasicInfos(users), nil
}

// GetUserCreatedAtRange 获取指定时间范围内注册的用户
func (p *ExternalUserProvider) GetUserCreatedAtRange(startTime, endTime time.Time, offset, limit int) ([]*UserBasicInfo, error) {
	var users []*User
	err := DB.Select("id", "account_id", "username", "display_name", "email", "phone", "account_type", "created_at", "last_active_at", "status").
		Where("created_at BETWEEN ? AND ? AND status = ?", startTime, endTime, UserStatusEnabled).
		Order("created_at desc").
		Offset(offset).
		Limit(limit).
		Find(&users).Error
	if err != nil {
		return nil, err
	}

	OverlayUsersIdentity(users)
	return toUserBasicInfos(users), nil
}

// toUserBasicInfos 将 users(已叠加账号中心权威身份)转为活动/分群所需的 UserBasicInfo 列表。
func toUserBasicInfos(users []*User) []*UserBasicInfo {
	result := make([]*UserBasicInfo, 0, len(users))
	for _, user := range users {
		if user == nil {
			continue
		}
		result = append(result, &UserBasicInfo{
			Id:           user.Id,
			Username:     user.Username,
			DisplayName:  user.DisplayName,
			Email:        user.Email,
			Phone:        user.Phone,
			AccountType:  user.AccountType,
			CreatedAt:    user.CreatedAt,
			LastActiveAt: user.LastActiveAt,
			Status:       user.Status,
		})
	}
	return result
}

// CountUsersByAccountType 统计指定账户类型的用户数量
func (p *ExternalUserProvider) CountUsersByAccountType(accountType int) (int64, error) {
	var count int64
	err := DB.Model(&User{}).
		Where("account_type = ? AND status = ?", accountType, UserStatusEnabled).
		Count(&count).Error
	return count, err
}

// IsUserActive 判断用户是否处于活跃状态
func (p *ExternalUserProvider) IsUserActive(userId int) (bool, error) {
	var user User
	err := DB.Select("status").Where("id = ?", userId).First(&user).Error
	if err != nil {
		return false, err
	}
	return user.Status == UserStatusEnabled, nil
}
