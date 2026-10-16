package model

import (
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/snowflake"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupIdentityUpdateDB(t *testing.T) *gorm.DB {
	t.Helper()
	require.NoError(t, snowflake.Init(0))
	if dsn := os.Getenv("DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN"); dsn != "" {
		schema := "identity_update_" + strconv.FormatInt(time.Now().UnixNano(), 10)
		admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		require.NoError(t, err)
		require.NoError(t, admin.Exec("CREATE SCHEMA "+schema).Error)
		db, err := gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
		require.NoError(t, err)
		previous, previousAccount := DB, ACCOUNT_DB
		DB, ACCOUNT_DB = db, db
		t.Cleanup(func() {
			DB, ACCOUNT_DB = previous, previousAccount
			admin.Exec("DROP SCHEMA " + schema + " CASCADE")
			sqlDB, _ := db.DB()
			sqlDB.Close()
			sqlAdmin, _ := admin.DB()
			sqlAdmin.Close()
		})
		require.NoError(t, db.AutoMigrate(&User{}, &Account{}, &AccountProduct{}, &AccountProfile{}, &AccountIdentifier{}, &AccountCredential{}))
		return db
	}
	db, _ := setupAccountTestDB(t)
	return db
}

func createIdentityUpdateUser(t *testing.T, db *gorm.DB, name string) *User {
	t.Helper()
	user := &User{Username: name, DisplayName: name, Status: UserStatusEnabled, AccessToken: name + "_token", AffCode: name + "_aff"}
	require.NoError(t, db.Create(user).Error)
	_, err := EnsureAccountForUser(user)
	require.NoError(t, err)
	return user
}

func TestUserIdentityUpdateUsernameAndConflict(t *testing.T) {
	db := setupIdentityUpdateDB(t)
	user := createIdentityUpdateUser(t, db, "before")
	other := createIdentityUpdateUser(t, db, "taken")
	update := User{Id: user.Id, Username: "after"}
	require.NoError(t, WriteAccountCredentialByLocalUser(user.Id, "LoginPass123"))
	require.NoError(t, update.Update(false))
	loaded, err := GetUserByUsername("after")
	require.NoError(t, err)
	require.Equal(t, user.Id, loaded.Id)
	_, err = GetUserByUsername("before")
	require.Error(t, err)
	login := User{Username: "after", Password: "LoginPass123"}
	require.NoError(t, login.ValidateAndFill())
	oldLogin := User{Username: "before", Password: "LoginPass123"}
	require.Error(t, oldLogin.ValidateAndFill())
	update.Username = other.Username
	require.Error(t, update.Update(false))
	loaded, err = GetUserByUsername("after")
	require.NoError(t, err)
	require.Equal(t, user.Id, loaded.Id)
}

func TestUserIdentityUpdatePhoneConflictPreservesBinding(t *testing.T) {
	db := setupIdentityUpdateDB(t)
	user := createIdentityUpdateUser(t, db, "phone_a")
	other := createIdentityUpdateUser(t, db, "phone_b")
	require.NoError(t, UpdateUserPhone(user.Id, "+8613800000001"))
	require.NoError(t, UpdateUserPhone(other.Id, "+8613800000002"))
	require.Error(t, UpdateUserPhone(user.Id, "+8613800000002"))
	loaded, err := GetUserById(user.Id, false)
	require.NoError(t, err)
	require.Equal(t, "+8613800000001", loaded.Phone)
}

func TestUserIdentityUpdatePasswordFailureIsReturned(t *testing.T) {
	db := setupIdentityUpdateDB(t)
	user := createIdentityUpdateUser(t, db, "password")
	require.NoError(t, ACCOUNT_DB.Migrator().DropTable(&AccountCredential{}))
	update := User{Id: user.Id, Password: "NewPass123"}
	require.Error(t, update.Update(true))
}

func TestUserIdentityUpdateEmailResetUsesAccountIdentifier(t *testing.T) {
	db := setupIdentityUpdateDB(t)
	user := createIdentityUpdateUser(t, db, "email")
	require.NoError(t, WriteAccountIdentifierByLocalUser(user.Id, IdentifierTypeEmail, "real@example.test", true, "test"))
	require.NoError(t, ResetUserPasswordByEmail("real@example.test", "NewPass123"))
	var credential AccountCredential
	require.NoError(t, ACCOUNT_DB.First(&credential, "account_id = ?", *user.AccountId).Error)
	require.True(t, common.ValidatePasswordAndHash("NewPass123", credential.PasswordHash))
	require.Error(t, ResetUserPasswordByEmail("missing@example.test", "NewPass123"))
	require.NoError(t, ACCOUNT_DB.Migrator().DropTable(&AccountCredential{}))
	require.Error(t, ResetUserPasswordByEmail("real@example.test", "NewPass123"))
}

func TestUserIdentityUpdateMissingMappingDoesNotFallback(t *testing.T) {
	db := setupIdentityUpdateDB(t)
	user := createIdentityUpdateUser(t, db, "mapping")
	require.NoError(t, ACCOUNT_DB.Where("local_user_id = ?", user.Id).Delete(&AccountProduct{}).Error)
	require.Error(t, WriteAccountCredentialByLocalUser(user.Id, "NewPass123"))
	require.Error(t, WriteAccountIdentifierByLocalUser(user.Id, IdentifierTypePhone, "+8613800000000", true, "test"))
	require.Error(t, ClearAccountIdentifierByLocalUser(user.Id, IdentifierTypePhone, "test"))
}
