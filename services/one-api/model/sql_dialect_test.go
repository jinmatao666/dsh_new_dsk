package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/assert"
)

func TestSQLDialectHelpersPostgreSQL(t *testing.T) {
	previousPostgres := common.UsingPostgreSQL
	previousSQLite := common.UsingSQLite
	t.Cleanup(func() {
		common.UsingPostgreSQL = previousPostgres
		common.UsingSQLite = previousSQLite
	})

	common.UsingPostgreSQL = true
	common.UsingSQLite = false

	assert.Equal(t, `"group"`, quoteSQLIdentifier("group"))
	assert.Equal(t, `abilities."group"`, qualifiedSQLColumn("abilities", "group"))
	assert.Equal(t, "TRUE", sqlBooleanLiteral(true))
	assert.Equal(t, "FALSE", sqlBooleanLiteral(false))
	assert.Equal(t, "DATE(TO_TIMESTAMP(redeemed_at))", unixDateSQL("redeemed_at"))
}

func TestSQLDialectHelpersMySQL(t *testing.T) {
	previousPostgres := common.UsingPostgreSQL
	previousSQLite := common.UsingSQLite
	t.Cleanup(func() {
		common.UsingPostgreSQL = previousPostgres
		common.UsingSQLite = previousSQLite
	})

	common.UsingPostgreSQL = false
	common.UsingSQLite = false

	assert.Equal(t, "`key`", quoteSQLIdentifier("key"))
	assert.Equal(t, "0", sqlBooleanLiteral(false))
	assert.Equal(t, "DATE(FROM_UNIXTIME(created_at))", unixDateSQL("created_at"))
}

func TestSQLDialectHelpersSQLite(t *testing.T) {
	previousPostgres := common.UsingPostgreSQL
	previousSQLite := common.UsingSQLite
	t.Cleanup(func() {
		common.UsingPostgreSQL = previousPostgres
		common.UsingSQLite = previousSQLite
	})

	common.UsingPostgreSQL = false
	common.UsingSQLite = true

	assert.Equal(t, "DATE(redeemed_at, 'unixepoch')", unixDateSQL("redeemed_at"))
}
