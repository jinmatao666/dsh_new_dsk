package model

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/songquanpeng/one-api/common"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const provinceTestDeviceID = "11111111-2222-4333-8444-555555555555"

func setupProvinceSSOTestDB(t *testing.T) {
	t.Helper()
	previousDB, previousAccountDB := DB, ACCOUNT_DB
	previousSQLite := common.UsingSQLite
	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	DB = db
	ACCOUNT_DB = nil
	common.UsingSQLite = true
	if err := DB.AutoMigrate(&User{}, &Token{}, &ProvinceIdentity{}, &ProvinceLaunchCode{}, &ProvinceDeviceToken{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		DB = previousDB
		ACCOUNT_DB = previousAccountDB
		common.UsingSQLite = previousSQLite
	})
}

func TestProvinceFirstLoginCreatesCommonUserAndSynchronizesProfile(t *testing.T) {
	setupProvinceSSOTestDB(t)
	user, err := UpsertProvinceUser(context.Background(), ProvinceProfile{
		Account:  "province-user-1",
		Name:     "测试用户",
		IsActive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if user.Role != RoleCommonUser || user.Status != UserStatusEnabled {
		t.Fatalf("unexpected user role/status: %d/%d", user.Role, user.Status)
	}

	var identity ProvinceIdentity
	if err := DB.Where("account = ?", "province-user-1").First(&identity).Error; err != nil {
		t.Fatal(err)
	}
	if identity.UserId != user.Id || identity.Name != "测试用户" || !identity.IsActive {
		t.Fatalf("unexpected province identity: %+v", identity)
	}

	updated, err := UpsertProvinceUser(context.Background(), ProvinceProfile{
		Account:  "province-user-1",
		Name:     "新姓名",
		IsActive: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Id != user.Id || updated.Status != UserStatusDisabled || updated.Role != RoleCommonUser {
		t.Fatalf("existing account was not synchronized safely: %+v", updated)
	}
}

func TestProvinceLoginDoesNotTakeOverUnmappedAccountOrChangeMappedRole(t *testing.T) {
	setupProvinceSSOTestDB(t)
	collision := User{Username: "collision", Status: UserStatusEnabled, Role: RoleAdminUser}
	if err := DB.Create(&collision).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := UpsertProvinceUser(context.Background(), ProvinceProfile{
		Account: "collision", IsActive: true,
	}); err == nil {
		t.Fatal("expected an unmapped local account collision to be rejected")
	}

	mapped := User{Username: "mapped-admin", Status: UserStatusEnabled, Role: RoleAdminUser}
	if err := DB.Create(&mapped).Error; err != nil {
		t.Fatal(err)
	}
	if err := DB.Create(&ProvinceIdentity{
		UserId: mapped.Id, Account: mapped.Username, IsActive: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	updated, err := UpsertProvinceUser(context.Background(), ProvinceProfile{
		Account: mapped.Username, ExternalRole: "external-super-admin", IsActive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Role != RoleAdminUser {
		t.Fatalf("external role must not overwrite the existing Parvis role: %d", updated.Role)
	}
}

func TestProvinceLaunchCodeSingleUseAndDeviceTokenReuse(t *testing.T) {
	setupProvinceSSOTestDB(t)
	user := User{Username: "province-user", Status: UserStatusEnabled, Role: RoleCommonUser}
	if err := DB.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := DB.Create(&ProvinceIdentity{
		UserId: user.Id, Account: user.Username, Name: "测试用户", IsActive: true, LastSyncedAt: time.Now(),
	}).Error; err != nil {
		t.Fatal(err)
	}

	code, err := CreateProvinceLaunchCode(user.Id)
	if err != nil {
		t.Fatal(err)
	}
	first, err := ConsumeProvinceLaunchCode(code, provinceTestDeviceID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ConsumeProvinceLaunchCode(code, provinceTestDeviceID); err == nil {
		t.Fatal("expected consumed launch code to be rejected")
	}

	secondCode, err := CreateProvinceLaunchCode(user.Id)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ConsumeProvinceLaunchCode(secondCode, provinceTestDeviceID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Token.Id != second.Token.Id || first.Token.Key != second.Token.Key {
		t.Fatal("same user and device should reuse the active token")
	}

	if err := RevokeProvinceDeviceToken(user.Id, second.Token.Id, provinceTestDeviceID); err != nil {
		t.Fatal(err)
	}
	var revoked Token
	if err := DB.First(&revoked, second.Token.Id).Error; err != nil {
		t.Fatal(err)
	}
	if revoked.Status != TokenStatusDisabled {
		t.Fatalf("expected revoked token status, got %d", revoked.Status)
	}
}

func TestProvinceLaunchCodeExpiry(t *testing.T) {
	setupProvinceSSOTestDB(t)
	user := User{Username: "expired-user", Status: UserStatusEnabled, Role: RoleCommonUser}
	if err := DB.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := DB.Create(&ProvinceIdentity{UserId: user.Id, Account: user.Username, IsActive: true}).Error; err != nil {
		t.Fatal(err)
	}
	code := "expired-code"
	if err := DB.Create(&ProvinceLaunchCode{
		CodeHash:  provinceCodeHash(code),
		UserId:    user.Id,
		ExpiresAt: time.Now().Add(-time.Second),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ConsumeProvinceLaunchCode(code, provinceTestDeviceID); err == nil {
		t.Fatal("expected expired launch code to be rejected")
	}
}
