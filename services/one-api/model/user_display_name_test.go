package model

import (
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"os"
	"strconv"
	"testing"
	"time"
)

func TestUpdateUserDisplayNameAuthoritativeProfile(t *testing.T) {
	var main, account *gorm.DB
	if dsn := os.Getenv("DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN"); dsn != "" {
		schema := "display_name_test_" + strconv.FormatInt(time.Now().UnixNano(), 10)
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		require.NoError(t, err)
		require.NoError(t, db.Exec("CREATE SCHEMA "+schema).Error)
		main, err = gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
		require.NoError(t, err)
		account = main
		previous, previousAccount := DB, ACCOUNT_DB
		DB, ACCOUNT_DB = main, account
		t.Cleanup(func() { DB, ACCOUNT_DB = previous, previousAccount; db.Exec("DROP SCHEMA " + schema + " CASCADE") })
		require.NoError(t, main.AutoMigrate(&User{}, &AccountProfile{}, &AccountProduct{}))
	} else {
		main, account = setupAccountTestDB(t)
	}
	user := &User{Username: "name_test", DisplayName: "旧昵称", Status: UserStatusEnabled, AccessToken: "name_token", AffCode: "name_aff"}
	require.NoError(t, main.Create(user).Error)
	id := int64(12345)
	require.NoError(t, account.Create(&AccountProduct{AccountId: id, ProductCode: ProductCodeParvis, LocalUserId: int64(user.Id)}).Error)
	require.NoError(t, main.Model(user).Update("account_id", id).Error)
	require.NoError(t, UpdateUserDisplayName(user.Id, "新昵称"))
	profile, err := GetAccountProfile(id)
	require.NoError(t, err)
	require.Equal(t, "新昵称", profile.DisplayName)
	loaded, err := GetUserById(user.Id, false)
	require.NoError(t, err)
	require.Equal(t, "新昵称", loaded.DisplayName)
	require.Error(t, UpdateUserDisplayName(user.Id, ""))
	require.NoError(t, account.Migrator().DropTable(&AccountProfile{}))
	require.Error(t, UpdateUserDisplayName(user.Id, "写入失败"))
}

func TestUpdateUserDisplayNameRequiresAccountCenter(t *testing.T) {
	previous := ACCOUNT_DB
	ACCOUNT_DB = nil
	t.Cleanup(func() { ACCOUNT_DB = previous })
	require.ErrorIs(t, UpdateUserDisplayName(1, "昵称"), ErrAccountCenterDisabled)
}
