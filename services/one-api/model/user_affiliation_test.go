package model

import (
	"strings"
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type affiliationLegacyUser struct {
	Id       int
	Username string `gorm:"unique;index"`
}

func (affiliationLegacyUser) TableName() string { return "users" }

func TestUserAffiliationMigrationAndUpdates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	// Use the same DDL generator as production; handwritten SQLite types can trigger an unrelated parser rebuild.
	require.NoError(t, db.AutoMigrate(&affiliationLegacyUser{}))
	require.NoError(t, db.Create(&affiliationLegacyUser{Id: 1, Username: "existing"}).Error)
	require.NoError(t, db.AutoMigrate(&User{}))
	savedDB, savedAccountDB := DB, ACCOUNT_DB
	DB, ACCOUNT_DB = db, nil
	t.Cleanup(func() { DB, ACCOUNT_DB = savedDB, savedAccountDB })
	var user User
	require.NoError(t, db.First(&user, 1).Error)
	require.Empty(t, user.UnitName)
	require.Empty(t, user.DepartmentName)
	unit, department := " 单位甲 ", " 部门甲 "
	require.NoError(t, UpdateUserAffiliation(1, &unit, &department))
	require.NoError(t, db.First(&user, 1).Error)
	require.Equal(t, "单位甲", user.UnitName)
	require.Equal(t, "部门甲", user.DepartmentName)
	require.Equal(t, "default", user.Group)
	require.Equal(t, AccountTypePersonal, user.AccountType)
	empty := ""
	require.NoError(t, UpdateUserAffiliation(1, nil, &empty))
	require.NoError(t, db.First(&user, 1).Error)
	require.Equal(t, "单位甲", user.UnitName)
	require.Empty(t, user.DepartmentName)
	require.NoError(t, UpdateUserAffiliation(1, nil, nil))
	partial := User{Id: 1, UnitName: "不允许的自助修改", DepartmentName: "不允许的自助修改"}
	require.NoError(t, partial.Update(false))
	users, err := GetAllUsers(0, 20, "")
	require.NoError(t, err)
	require.Equal(t, "单位甲", users[0].UnitName)
	require.Empty(t, users[0].DepartmentName)
}

func TestUserAffiliationValidation(t *testing.T) {
	user := User{Username: "tester", Password: "Abc12345", UnitName: strings.Repeat("中", 100), DepartmentName: strings.Repeat("文", 100)}
	require.NoError(t, common.Validate.Struct(&user))
	user.UnitName += "中"
	require.Error(t, common.Validate.Struct(&user))
	user.UnitName = ""
	user.DepartmentName += "文"
	require.Error(t, common.Validate.Struct(&user))
}
