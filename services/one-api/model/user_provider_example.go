package model

// 本文件展示如何使用 UserProvider 接口
// 供活动系统等模块参考

// Example: 活动系统中获取符合条件的用户
func ExampleGetEligibleUsersForActivity(accountType int) ([]*UserBasicInfo, error) {
	provider := GetUserProvider()

	// 获取指定账户类型的所有活跃用户
	users, err := provider.GetUsersByAccountType(accountType, 0, 100)
	if err != nil {
		return nil, err
	}

	return users, nil
}

// Example: 检查用户是否有资格参与活动
func ExampleCheckUserEligibility(userId int) (bool, error) {
	provider := GetUserProvider()

	// 获取用户基本信息
	user, err := provider.GetUserBasicInfo(userId)
	if err != nil {
		return false, err
	}

	// 检查用户是否活跃
	if user.Status != UserStatusEnabled {
		return false, nil
	}

	// 可以根据 user.AccountType、user.CreatedAt 等字段进行更多判断
	return true, nil
}

// Example: 批量检查用户状态
func ExampleBatchCheckUsers(userIds []int) (map[int]bool, error) {
	provider := GetUserProvider()

	users, err := provider.GetUsersByIds(userIds)
	if err != nil {
		return nil, err
	}

	result := make(map[int]bool)
	for _, user := range users {
		result[user.Id] = user.Status == UserStatusEnabled
	}

	return result, nil
}
