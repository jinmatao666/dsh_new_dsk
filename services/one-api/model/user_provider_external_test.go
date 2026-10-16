package model_test

import (
	"testing"
	"time"

	"github.com/songquanpeng/one-api/model"
)

func TestMockUserProvider_GetUserBasicInfo(t *testing.T) {
	provider := model.NewMockUserProvider()

	// 测试获取存在的用户
	user, err := provider.GetUserBasicInfo(1)
	if err != nil {
		t.Fatalf("获取用户失败: %v", err)
	}
	if user.Id != 1 {
		t.Errorf("期望用户ID为1，实际为%d", user.Id)
	}
	if user.Username != "test_personal_001" {
		t.Errorf("期望用户名为test_personal_001，实际为%s", user.Username)
	}
	if user.AccountType != model.AccountTypePersonal {
		t.Errorf("期望账户类型为%d，实际为%d", model.AccountTypePersonal, user.AccountType)
	}

	// 测试获取不存在的用户
	_, err = provider.GetUserBasicInfo(999)
	if err == nil {
		t.Error("期望获取不存在用户时返回错误")
	}
}

func TestMockUserProvider_GetUsersByAccountType(t *testing.T) {
	provider := model.NewMockUserProvider()

	// 测试获取个人用户
	users, err := provider.GetUsersByAccountType(model.AccountTypePersonal, 0, 10)
	if err != nil {
		t.Fatalf("获取个人用户失败: %v", err)
	}
	// 应该有3个启用的个人用户（ID 1, 2, 4）
	if len(users) != 3 {
		t.Errorf("期望获取3个个人用户，实际获取%d个", len(users))
	}
	for _, user := range users {
		if user.AccountType != model.AccountTypePersonal {
			t.Errorf("用户%d的账户类型不是个人类型", user.Id)
		}
		if user.Status != model.UserStatusEnabled {
			t.Errorf("用户%d的状态不是启用状态", user.Id)
		}
	}

	// 测试获取企业用户
	users, err = provider.GetUsersByAccountType(model.AccountTypeEnterprise, 0, 10)
	if err != nil {
		t.Fatalf("获取企业用户失败: %v", err)
	}
	// 应该有1个启用的企业用户（ID 3）
	if len(users) != 1 {
		t.Errorf("期望获取1个企业用户，实际获取%d个", len(users))
	}
	if users[0].AccountType != model.AccountTypeEnterprise {
		t.Error("获取的用户不是企业类型")
	}

	// 测试分页
	users, err = provider.GetUsersByAccountType(model.AccountTypePersonal, 1, 2)
	if err != nil {
		t.Fatalf("分页查询失败: %v", err)
	}
	if len(users) != 2 {
		t.Errorf("期望分页获取2个用户，实际获取%d个", len(users))
	}
}

func TestMockUserProvider_GetUsersByIds(t *testing.T) {
	provider := model.NewMockUserProvider()

	// 测试批量获取存在的用户
	userIds := []int{1, 2, 3}
	users, err := provider.GetUsersByIds(userIds)
	if err != nil {
		t.Fatalf("批量获取用户失败: %v", err)
	}
	if len(users) != 3 {
		t.Errorf("期望获取3个用户，实际获取%d个", len(users))
	}

	// 测试包含不存在的用户ID
	userIds = []int{1, 999, 2}
	users, err = provider.GetUsersByIds(userIds)
	if err != nil {
		t.Fatalf("批量获取用户失败: %v", err)
	}
	// 只应该返回存在的用户
	if len(users) != 2 {
		t.Errorf("期望获取2个存在的用户，实际获取%d个", len(users))
	}

	// 测试空列表
	users, err = provider.GetUsersByIds([]int{})
	if err != nil {
		t.Fatalf("空列表查询失败: %v", err)
	}
	if len(users) != 0 {
		t.Errorf("期望获取0个用户，实际获取%d个", len(users))
	}
}

func TestMockUserProvider_GetUserCreatedAtRange(t *testing.T) {
	provider := model.NewMockUserProvider()

	now := time.Now()

	// 测试获取最近30天注册的用户
	startTime := now.AddDate(0, 0, -30)
	endTime := now
	users, err := provider.GetUserCreatedAtRange(startTime, endTime, 0, 10)
	if err != nil {
		t.Fatalf("按时间范围获取用户失败: %v", err)
	}
	// 应该至少有一个用户（ID 4，7天前注册）
	if len(users) < 1 {
		t.Errorf("期望获取至少1个用户，实际获取%d个", len(users))
	}
	for _, user := range users {
		if user.CreatedAt.Before(startTime) || user.CreatedAt.After(endTime) {
			t.Errorf("用户%d的注册时间不在指定范围内", user.Id)
		}
	}

	// 测试获取3-6个月前注册的用户
	startTime = now.AddDate(0, -6, 0)
	endTime = now.AddDate(0, -3, 0)
	users, err = provider.GetUserCreatedAtRange(startTime, endTime, 0, 10)
	if err != nil {
		t.Fatalf("按时间范围获取用户失败: %v", err)
	}
	// 应该有至少1个用户（ID 1 在6个月前，ID 2 在3个月前，具体取决于边界）
	if len(users) < 1 {
		t.Errorf("期望获取至少1个用户，实际获取%d个", len(users))
	}
}

func TestMockUserProvider_CountUsersByAccountType(t *testing.T) {
	provider := model.NewMockUserProvider()

	// 统计个人用户
	count, err := provider.CountUsersByAccountType(model.AccountTypePersonal)
	if err != nil {
		t.Fatalf("统计个人用户失败: %v", err)
	}
	if count != 3 {
		t.Errorf("期望个人用户数为3，实际为%d", count)
	}

	// 统计企业用户
	count, err = provider.CountUsersByAccountType(model.AccountTypeEnterprise)
	if err != nil {
		t.Fatalf("统计企业用户失败: %v", err)
	}
	if count != 1 {
		t.Errorf("期望企业用户数为1，实际为%d", count)
	}
}

func TestMockUserProvider_IsUserActive(t *testing.T) {
	provider := model.NewMockUserProvider()

	// 测试启用用户
	active, err := provider.IsUserActive(1)
	if err != nil {
		t.Fatalf("检查用户状态失败: %v", err)
	}
	if !active {
		t.Error("用户1应该是启用状态")
	}

	// 测试禁用用户
	active, err = provider.IsUserActive(5)
	if err != nil {
		t.Fatalf("检查用户状态失败: %v", err)
	}
	if active {
		t.Error("用户5应该是禁用状态")
	}

	// 测试不存在的用户
	_, err = provider.IsUserActive(999)
	if err == nil {
		t.Error("期望检查不存在用户时返回错误")
	}
}

func TestMockUserProvider_AddAndRemoveUser(t *testing.T) {
	provider := model.NewMockUserProvider()

	// 添加新用户
	newUser := &model.UserBasicInfo{
		Id:          100,
		Username:    "test_new_user",
		DisplayName: "新测试用户",
		Email:       "newuser@example.com",
		Phone:       "+8613800138100",
		AccountType: model.AccountTypePersonal,
		CreatedAt:   time.Now(),
		Status:      model.UserStatusEnabled,
	}
	provider.AddMockUser(newUser)

	// 验证添加成功
	user, err := provider.GetUserBasicInfo(100)
	if err != nil {
		t.Fatalf("获取新添加的用户失败: %v", err)
	}
	if user.Username != "test_new_user" {
		t.Errorf("新用户名不匹配，期望test_new_user，实际%s", user.Username)
	}

	// 移除用户
	provider.RemoveMockUser(100)

	// 验证移除成功
	_, err = provider.GetUserBasicInfo(100)
	if err == nil {
		t.Error("期望移除后获取用户时返回错误")
	}
}

func TestMockUserProvider_ClearUsers(t *testing.T) {
	provider := model.NewMockUserProvider()

	// 确认初始有用户
	count, _ := provider.CountUsersByAccountType(model.AccountTypePersonal)
	if count == 0 {
		t.Fatal("初始状态应该有个人用户")
	}

	// 清空所有用户
	provider.ClearMockUsers()

	// 验证清空成功
	count, _ = provider.CountUsersByAccountType(model.AccountTypePersonal)
	if count != 0 {
		t.Errorf("清空后期望用户数为0，实际为%d", count)
	}

	count, _ = provider.CountUsersByAccountType(model.AccountTypeEnterprise)
	if count != 0 {
		t.Errorf("清空后期望企业用户数为0，实际为%d", count)
	}
}

func TestInitUserProvider(t *testing.T) {
	// 测试初始化为 mock 类型
	err := model.InitUserProvider("mock")
	if err != nil {
		t.Fatalf("初始化mock提供者失败: %v", err)
	}
	provider := model.GetUserProvider()
	if provider == nil {
		t.Fatal("获取的提供者为nil")
	}
	if _, ok := provider.(*model.MockUserProvider); !ok {
		t.Error("期望获取MockUserProvider类型")
	}

	// 测试默认初始化
	err = model.InitUserProvider("unknown")
	if err != nil {
		t.Fatalf("初始化默认提供者失败: %v", err)
	}
	provider = model.GetUserProvider()
	if provider == nil {
		t.Fatal("获取的提供者为nil")
	}
}
