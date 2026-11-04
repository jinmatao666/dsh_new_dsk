package model

import (
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"testing"
)

func TestRegistrationRolePolicy(t *testing.T) {
	old := DB
	oldOptions := config.OptionMap
	config.OptionMap = map[string]string{}
	t.Cleanup(func() { DB = old; config.OptionMap = oldOptions })
	var err error
	DB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = DB.AutoMigrate(&Role{}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []Role{{Role: 1, Name: "普通成员", Status: 1}, {Role: 3, Name: "注册用户", Status: 1}, {Role: 4, Name: "停用", Status: 2}, {Role: 100, Name: "超级管理员", Status: 1}} {
		if err = DB.Create(&Role{Role: role.Role, Name: role.Name, Status: role.Status, Permissions: defaultRolePermissions()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tt := range []struct {
		value string
		want  int
		fail  bool
	}{{"", 3, false}, {"1", 1, false}, {"4", 0, true}, {"100", 0, true}, {"9", 0, true}, {"bad", 0, true}} {
		got, err := ResolveRegistrationRole(tt.value)
		if (err != nil) != tt.fail || !tt.fail && got != tt.want {
			t.Fatalf("%q got=%d err=%v", tt.value, got, err)
		}
	}
	config.OptionMap["RegistrationDefaultRole"] = ""
	user := User{Role: 1}
	if err = AssignRegistrationRole(&user); err != nil || user.Role != 3 {
		t.Fatalf("role=%d err=%v", user.Role, err)
	}
	if err = DeleteRole(3); err == nil {
		t.Fatal("default registration role was deleted")
	}
	if err = UpdateRole(&Role{Role: 3, Name: "changed", Status: 1}); err == nil {
		t.Fatal("implicit default role renamed")
	}
	if err = UpdateRole(&Role{Role: 3, Name: "注册用户", Status: 2}); err == nil {
		t.Fatal("default registration role disabled")
	}
	DB.Model(&Role{}).Where("role = ?", 3).Update("status", 2)
	if _, err = ResolveRegistrationRole(""); err == nil {
		t.Fatal("disabled default must fail closed")
	}
}
