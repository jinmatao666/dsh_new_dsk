package model

import "time"

// CurrentUserProvider 当前 users 表的适配器实现
type CurrentUserProvider struct{}

// NewCurrentUserProvider 创建当前用户提供者实例
func NewCurrentUserProvider() *CurrentUserProvider {
	return &CurrentUserProvider{}
}

// GetUserBasicInfo 获取用户基础信息
func (p *CurrentUserProvider) GetUserBasicInfo(userId int) (*UserBasicInfo, error) {
	var user User
	err := DB.Select("id", "username", "display_name", "email", "phone", "account_type", "created_at", "status").
		Where("id = ?", userId).
		First(&user).Error
	if err != nil {
		return nil, err
	}

	return &UserBasicInfo{
		Id:          user.Id,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		Email:       user.Email,
		Phone:       user.Phone,
		AccountType: user.AccountType,
		CreatedAt:   user.CreatedAt,
		Status:      user.Status,
	}, nil
}

// GetUsersByAccountType 根据账户类型获取用户列表
func (p *CurrentUserProvider) GetUsersByAccountType(accountType int, offset, limit int) ([]*UserBasicInfo, error) {
	var users []User
	err := DB.Select("id", "username", "display_name", "email", "phone", "account_type", "created_at", "status").
		Where("account_type = ? AND status = ?", accountType, UserStatusEnabled).
		Order("id desc").
		Offset(offset).
		Limit(limit).
		Find(&users).Error
	if err != nil {
		return nil, err
	}

	result := make([]*UserBasicInfo, 0, len(users))
	for _, user := range users {
		result = append(result, &UserBasicInfo{
			Id:          user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Email:       user.Email,
			Phone:       user.Phone,
			AccountType: user.AccountType,
			CreatedAt:   user.CreatedAt,
			Status:      user.Status,
		})
	}
	return result, nil
}

// GetUsersByIds 批量获取用户信息
func (p *CurrentUserProvider) GetUsersByIds(userIds []int) ([]*UserBasicInfo, error) {
	if len(userIds) == 0 {
		return []*UserBasicInfo{}, nil
	}

	var users []User
	err := DB.Select("id", "username", "display_name", "email", "phone", "account_type", "created_at", "status").
		Where("id IN ?", userIds).
		Find(&users).Error
	if err != nil {
		return nil, err
	}

	result := make([]*UserBasicInfo, 0, len(users))
	for _, user := range users {
		result = append(result, &UserBasicInfo{
			Id:          user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Email:       user.Email,
			Phone:       user.Phone,
			AccountType: user.AccountType,
			CreatedAt:   user.CreatedAt,
			Status:      user.Status,
		})
	}
	return result, nil
}

// GetUserCreatedAtRange 获取指定时间范围内注册的用户
func (p *CurrentUserProvider) GetUserCreatedAtRange(startTime, endTime time.Time, offset, limit int) ([]*UserBasicInfo, error) {
	var users []User
	err := DB.Select("id", "username", "display_name", "email", "phone", "account_type", "created_at", "status").
		Where("created_at BETWEEN ? AND ? AND status = ?", startTime, endTime, UserStatusEnabled).
		Order("created_at desc").
		Offset(offset).
		Limit(limit).
		Find(&users).Error
	if err != nil {
		return nil, err
	}

	result := make([]*UserBasicInfo, 0, len(users))
	for _, user := range users {
		result = append(result, &UserBasicInfo{
			Id:          user.Id,
			Username:    user.Username,
			DisplayName: user.DisplayName,
			Email:       user.Email,
			Phone:       user.Phone,
			AccountType: user.AccountType,
			CreatedAt:   user.CreatedAt,
			Status:      user.Status,
		})
	}
	return result, nil
}

// CountUsersByAccountType 统计指定账户类型的用户数量
func (p *CurrentUserProvider) CountUsersByAccountType(accountType int) (int64, error) {
	var count int64
	err := DB.Model(&User{}).
		Where("account_type = ? AND status = ?", accountType, UserStatusEnabled).
		Count(&count).Error
	return count, err
}

// IsUserActive 判断用户是否处于活跃状态
func (p *CurrentUserProvider) IsUserActive(userId int) (bool, error) {
	var user User
	err := DB.Select("status").Where("id = ?", userId).First(&user).Error
	if err != nil {
		return false, err
	}
	return user.Status == UserStatusEnabled, nil
}
