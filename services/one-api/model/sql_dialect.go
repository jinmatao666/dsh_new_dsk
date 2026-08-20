package model

import (
	"fmt"

	"github.com/songquanpeng/one-api/common"
)

// quoteSQLIdentifier quotes a trusted, code-defined identifier for the active
// database. PostgreSQL reserves names such as group and key, while MySQL uses
// backticks for the same identifiers.
func quoteSQLIdentifier(identifier string) string {
	if common.UsingPostgreSQL {
		return `"` + identifier + `"`
	}
	return "`" + identifier + "`"
}

func qualifiedSQLColumn(table, column string) string {
	return fmt.Sprintf("%s.%s", table, quoteSQLIdentifier(column))
}

func sqlBooleanLiteral(value bool) string {
	if common.UsingPostgreSQL {
		if value {
			return "TRUE"
		}
		return "FALSE"
	}
	if value {
		return "1"
	}
	return "0"
}

func unixDateSQL(column string) string {
	if common.UsingPostgreSQL {
		return "DATE(TO_TIMESTAMP(" + column + "))"
	}
	if common.UsingSQLite {
		return "DATE(" + column + ", 'unixepoch')"
	}
	return "DATE(FROM_UNIXTIME(" + column + "))"
}
