package model

import "time"

// UserBasicInfo 用户基础信息，用于活动系统展示和判断
type UserBasicInfo struct {
	Id           int        `json:"id"`
	Username     string     `json:"username"`
	DisplayName  string     `json:"display_name"`
	Email        string     `json:"email"`
	Phone        string     `json:"phone"`
	AccountType  int        `json:"account_type"` // 1=个人 2=企业
	CreatedAt    time.Time  `json:"created_at"`
	LastActiveAt *time.Time `json:"last_active_at"`
	Status       int        `json:"status"`
}

// UserProvider 定义用户数据访问的抽象接口
// 活动系统通过此接口获取用户数据，无需直接依赖 users 表
type UserProvider interface {
	// GetUserBasicInfo 获取用户基础信息
	GetUserBasicInfo(userId int) (*UserBasicInfo, error)

	// GetUsersByAccountType 根据账户类型获取用户列表
	// accountType: 1=个人 2=企业
	GetUsersByAccountType(accountType int, offset, limit int) ([]*UserBasicInfo, error)

	// GetUsersByIds 批量获取用户信息
	GetUsersByIds(userIds []int) ([]*UserBasicInfo, error)

	// GetUserCreatedAtRange 获取指定时间范围内注册的用户
	GetUserCreatedAtRange(startTime, endTime time.Time, offset, limit int) ([]*UserBasicInfo, error)

	// CountUsersByAccountType 统计指定账户类型的用户数量
	CountUsersByAccountType(accountType int) (int64, error)

	// IsUserActive 判断用户是否处于活跃状态（Status == UserStatusEnabled）
	IsUserActive(userId int) (bool, error)
}

// 全局用户提供者实例
var userProvider UserProvider

// InitUserProvider 初始化用户提供者
// providerType: "mock" | "current" | "external" | "new"
func InitUserProvider(providerType string) error {
	switch providerType {
	case "mock":
		userProvider = NewMockUserProvider()
	case "current":
		userProvider = NewCurrentUserProvider()
	case "external":
		// 使用账号中心数据库
		if ACCOUNT_DB == nil {
			return nil // ACCOUNT_DB 未初始化，回退到 current
		}
		userProvider = NewExternalUserProvider()
	case "new":
		// 预留给未来的新用户表实现
		userProvider = NewCurrentUserProvider()
	default:
		// 默认使用当前实现
		userProvider = NewCurrentUserProvider()
	}
	return nil
}

// GetUserProvider 获取全局用户提供者实例
func GetUserProvider() UserProvider {
	if userProvider == nil {
		// 默认初始化为当前实现
		_ = InitUserProvider("current")
	}
	return userProvider
}

// SetUserProvider 设置用户提供者（用于测试）
func SetUserProvider(provider UserProvider) {
	userProvider = provider
}
