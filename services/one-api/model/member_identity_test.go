package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupMemberIdentityTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&MemberIdentity{}, &Subscription{}, &User{}, &Log{}, &RechargePackage{}))
	DB = db
	LOG_DB = db
}

// 删除校验:身份被商品绑定(recharge_packages.identity_id)时不允许删除;解绑后可删。
func TestDeleteMemberIdentity_BlockedWhenBound(t *testing.T) {
	setupMemberIdentityTestDB(t)
	m := &MemberIdentity{Name: "绑定身份", PackageLevel: 2, Enabled: true}
	require.NoError(t, CreateMemberIdentity(m))

	// 无绑定时可删
	free := &MemberIdentity{Name: "空闲身份", PackageLevel: 1, Enabled: true}
	require.NoError(t, CreateMemberIdentity(free))
	require.NoError(t, DeleteMemberIdentity(free.Id))

	// 有商品绑定时拒绝删除
	require.NoError(t, DB.Create(&RechargePackage{Name: "季度套餐", Point: 1, IdentityId: m.Id, Enabled: true}).Error)
	assert.Error(t, DeleteMemberIdentity(m.Id))

	// 绑定的商品也能在列表里查到
	bound, err := GetIdentityBoundPackages()
	require.NoError(t, err)
	assert.Equal(t, []string{"季度套餐"}, bound[m.Id])
}

// 身份独立后:不再强制关联商品(PackageId),仅校验名称非空。
func TestCreateMemberIdentity_NoPackageRequired(t *testing.T) {
	setupMemberIdentityTestDB(t)

	// 不带 PackageId 也能创建
	m := &MemberIdentity{Name: "Pro会员", PackageLevel: 3, Enabled: true}
	require.NoError(t, CreateMemberIdentity(m))
	assert.Greater(t, m.Id, 0)

	// 名称为空仍然拒绝
	assert.Error(t, CreateMemberIdentity(&MemberIdentity{PackageLevel: 1}))
}

// 批量/活动发放:身份去掉 PackageId 后,发放仍按 PackageLevel + 天数建订阅。
func TestGrantMemberIdentityToUser_NoPackage(t *testing.T) {
	setupMemberIdentityTestDB(t)
	require.NoError(t, DB.Create(&User{Id: 400, Username: "g1", Password: "x", AccountType: AccountTypePersonal}).Error)

	m := &MemberIdentity{Name: "尊享", PackageLevel: 5, Enabled: true}
	require.NoError(t, CreateMemberIdentity(m))

	require.NoError(t, GrantMemberIdentityToUser(400, m.Id, 30, "ACT-1"))

	var sub Subscription
	require.NoError(t, DB.Where("user_id = ?", 400).First(&sub).Error)
	assert.Equal(t, 5, sub.PackageLevel, "订阅等级取自身份 PackageLevel")
	assert.Equal(t, 0, sub.PackageId, "身份独立后不再写 PackageId")
	assert.Equal(t, "admin_grant", sub.BillingCycle)
}
