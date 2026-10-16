package model

import (
	"errors"
	"sync"
	"time"
)

// MockUserProvider 模拟用户提供者，用于开发和测试
type MockUserProvider struct {
	mu    sync.RWMutex
	users map[int]*UserBasicInfo
}

// NewMockUserProvider 创建 Mock 用户提供者实例，包含测试数据
func NewMockUserProvider() *MockUserProvider {
	now := time.Now()

	return &MockUserProvider{
		users: map[int]*UserBasicInfo{
			1: {
				Id:          1,
				Username:    "test_personal_001",
				DisplayName: "个人用户张三",
				Email:       "zhangsan@example.com",
				Phone:       "+8613800138001",
				AccountType: AccountTypePersonal,
				CreatedAt:   now.AddDate(0, -6, 0), // 6个月前注册
				Status:      UserStatusEnabled,
			},
			2: {
				Id:          2,
				Username:    "test_personal_002",
				DisplayName: "个人用户李四",
				Email:       "lisi@example.com",
				Phone:       "+8613800138002",
				AccountType: AccountTypePersonal,
				CreatedAt:   now.AddDate(0, -3, 0), // 3个月前注册
				Status:      UserStatusEnabled,
			},
			3: {
				Id:          3,
				Username:    "test_enterprise_001",
				DisplayName: "企业用户王五",
				Email:       "wangwu@company.com",
				Phone:       "+8613800138003",
				AccountType: AccountTypeEnterprise,
				CreatedAt:   now.AddDate(0, -1, 0), // 1个月前注册
				Status:      UserStatusEnabled,
			},
			4: {
				Id:          4,
				Username:    "test_personal_003",
				DisplayName: "个人用户赵六",
				Email:       "zhaoliu@example.com",
				Phone:       "+8613800138004",
				AccountType: AccountTypePersonal,
				CreatedAt:   now.AddDate(0, 0, -7), // 7天前注册
				Status:      UserStatusEnabled,
			},
			5: {
				Id:          5,
				Username:    "test_disabled_001",
				DisplayName: "已禁用用户",
				Email:       "disabled@example.com",
				Phone:       "+8613800138005",
				AccountType: AccountTypePersonal,
				CreatedAt:   now.AddDate(0, -12, 0), // 12个月前注册
				Status:      UserStatusDisabled,
			},
		},
	}
}

// GetUserBasicInfo 获取用户基础信息
func (p *MockUserProvider) GetUserBasicInfo(userId int) (*UserBasicInfo, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	user, exists := p.users[userId]
	if !exists {
		return nil, errors.New("用户不存在")
	}

	// 返回副本，避免外部修改
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
func (p *MockUserProvider) GetUsersByAccountType(accountType int, offset, limit int) ([]*UserBasicInfo, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var result []*UserBasicInfo
	for _, user := range p.users {
		if user.AccountType == accountType && user.Status == UserStatusEnabled {
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
	}

	// 简单的分页处理
	if offset >= len(result) {
		return []*UserBasicInfo{}, nil
	}
	end := offset + limit
	if end > len(result) {
		end = len(result)
	}
	return result[offset:end], nil
}

// GetUsersByIds 批量获取用户信息
func (p *MockUserProvider) GetUsersByIds(userIds []int) ([]*UserBasicInfo, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if len(userIds) == 0 {
		return []*UserBasicInfo{}, nil
	}

	result := make([]*UserBasicInfo, 0, len(userIds))
	for _, userId := range userIds {
		if user, exists := p.users[userId]; exists {
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
	}
	return result, nil
}

// GetUserCreatedAtRange 获取指定时间范围内注册的用户
func (p *MockUserProvider) GetUserCreatedAtRange(startTime, endTime time.Time, offset, limit int) ([]*UserBasicInfo, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var result []*UserBasicInfo
	for _, user := range p.users {
		if user.Status == UserStatusEnabled &&
			!user.CreatedAt.Before(startTime) &&
			!user.CreatedAt.After(endTime) {
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
	}

	// 简单的分页处理
	if offset >= len(result) {
		return []*UserBasicInfo{}, nil
	}
	end := offset + limit
	if end > len(result) {
		end = len(result)
	}
	return result[offset:end], nil
}

// CountUsersByAccountType 统计指定账户类型的用户数量
func (p *MockUserProvider) CountUsersByAccountType(accountType int) (int64, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var count int64
	for _, user := range p.users {
		if user.AccountType == accountType && user.Status == UserStatusEnabled {
			count++
		}
	}
	return count, nil
}

// IsUserActive 判断用户是否处于活跃状态
func (p *MockUserProvider) IsUserActive(userId int) (bool, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	user, exists := p.users[userId]
	if !exists {
		return false, errors.New("用户不存在")
	}
	return user.Status == UserStatusEnabled, nil
}

// AddMockUser 添加模拟用户（测试辅助方法）
func (p *MockUserProvider) AddMockUser(user *UserBasicInfo) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.users[user.Id] = user
}

// RemoveMockUser 移除模拟用户（测试辅助方法）
func (p *MockUserProvider) RemoveMockUser(userId int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.users, userId)
}

// ClearMockUsers 清空所有模拟用户（测试辅助方法）
func (p *MockUserProvider) ClearMockUsers() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.users = make(map[int]*UserBasicInfo)
}
