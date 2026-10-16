package model

import (
	"testing"
	"time"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTimedQuotaBatchTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &UserTimedQuota{}))
	DB = db
	common.UsingPostgreSQL = false
}

func seedTimedQuotaBatchUser(t *testing.T, id int, username string, group string, status int, role int) {
	user := User{
		Id:          id,
		Username:    username,
		Email:       username + "@example.com",
		Status:      status,
		Role:        role,
		Group:       group,
		AccessToken: username + "-token",
		AffCode:     username + "-aff",
	}
	require.NoError(t, DB.Create(&user).Error)
}

func TestBatchAddUserTimedQuotaFiltersAndUpdatesBalances(t *testing.T) {
	setupTimedQuotaBatchTestDB(t)
	seedTimedQuotaBatchUser(t, 1, "alpha", "default", UserStatusEnabled, RoleCommonUser)
	seedTimedQuotaBatchUser(t, 2, "beta", "vip", UserStatusEnabled, RoleCommonUser)
	seedTimedQuotaBatchUser(t, 3, "gamma", "default", UserStatusDisabled, RoleCommonUser)
	seedTimedQuotaBatchUser(t, 4, "root", "default", UserStatusEnabled, RoleRootUser)

	filter := UserTimedQuotaBatchFilter{
		Groups: []string{"default"},
		Status: UserStatusEnabled,
		Role:   RoleCommonUser,
	}
	count, err := CountUsersForTimedQuotaBatch(filter)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)

	ttl := 7 * 24 * time.Hour
	result, err := BatchAddUserTimedQuota(filter, 500, "campaign-a", &ttl)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Matched)
	assert.Equal(t, []int{1}, result.UserIds)

	var user User
	require.NoError(t, DB.First(&user, 1).Error)
	assert.Equal(t, int64(500), user.TimedQuotaTotal)
	assert.Equal(t, int64(500), user.Quota)

	var rows []UserTimedQuota
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	assert.Equal(t, int64(500), rows[0].Amount)
	assert.Equal(t, int64(500), rows[0].Remaining)
	assert.Equal(t, TimedQuotaSourceAdmin, rows[0].Source)
	assert.Equal(t, "campaign-a", rows[0].SourceRef)
	assert.NotNil(t, rows[0].ExpiresAt)
}
