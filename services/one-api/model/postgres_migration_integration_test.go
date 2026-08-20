package model

import (
	"os"
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/require"
)

// TestPostgresMigrations is opt-in because it requires two disposable
// PostgreSQL databases. The databases must not contain valuable data.
func TestPostgresMigrations(t *testing.T) {
	mainDSN := os.Getenv("PARVIS_TEST_POSTGRES_DSN")
	accountDSN := os.Getenv("PARVIS_TEST_ACCOUNT_POSTGRES_DSN")
	if mainDSN == "" || accountDSN == "" {
		t.Skip("set PARVIS_TEST_POSTGRES_DSN and PARVIS_TEST_ACCOUNT_POSTGRES_DSN")
	}

	previousDB := DB
	previousAccountDB := ACCOUNT_DB
	previousPostgres := common.UsingPostgreSQL
	previousMySQL := common.UsingMySQL
	previousSQLite := common.UsingSQLite
	t.Cleanup(func() {
		if DB != nil {
			_ = closeDB(DB)
		}
		if ACCOUNT_DB != nil {
			_ = closeDB(ACCOUNT_DB)
		}
		DB = previousDB
		ACCOUNT_DB = previousAccountDB
		common.UsingPostgreSQL = previousPostgres
		common.UsingMySQL = previousMySQL
		common.UsingSQLite = previousSQLite
	})

	common.UsingPostgreSQL = false
	common.UsingMySQL = false
	common.UsingSQLite = false

	var err error
	DB, err = openPostgreSQL(mainDSN, true)
	require.NoError(t, err)
	ACCOUNT_DB, err = openPostgreSQL(accountDSN, false)
	require.NoError(t, err)

	require.NoError(t, migrateDB())
	require.NoError(t, migrateAccountDB())
	require.True(t, DB.Migrator().HasTable(&User{}))
	require.True(t, DB.Migrator().HasTable(&ProvinceIdentity{}))
	require.True(t, ACCOUNT_DB.Migrator().HasTable(&Account{}))
}
