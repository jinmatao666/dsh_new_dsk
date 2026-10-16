package model

import (
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestSkillTestSessionDialectTextTypes(t *testing.T) {
	parsed, err := schema.Parse(&SkillTestSession{}, &sync.Map{}, schema.NamingStrategy{})
	require.NoError(t, err)
	for _, driver := range []struct {
		name    string
		dialect gorm.Dialector
		want    string
	}{
		{"postgres", postgres.New(postgres.Config{}), "text"},
		{"mysql", mysql.New(mysql.Config{}), "longtext"},
		{"sqlite", sqlite.Open(":memory:"), "text"},
	} {
		t.Run(driver.name, func(t *testing.T) {
			for _, name := range []string{"Snapshot", "Transcript", "Events"} {
				field := parsed.LookUpField(name)
				require.NotNil(t, field)
				require.Equal(t, schema.String, field.DataType, name)
				require.Zero(t, field.Size, name)
				require.Equal(t, driver.want, driver.dialect.DataTypeOf(field), name)
			}
		})
	}
}

func TestSkillTestSessionMigrationAndLargeTextRoundTrip(t *testing.T) {
	// Uses an isolated PostgreSQL schema when the existing test DSN is supplied;
	// otherwise the release's CGO-enabled builder exercises in-memory SQLite.
	setupSkillInstallationTestDB(t)
	require.NoError(t, DB.AutoMigrate(&SkillTestSession{}))
	longText := strings.Repeat("中文审核内容\n", 20000)
	row := SkillTestSession{Id: strings.Repeat("a", 32), SkillId: 1,
		Snapshot: longText, Transcript: longText, Events: longText, Status: "idle"}
	require.NoError(t, DB.Create(&row).Error)
	// Restart migration must preserve existing review data.
	require.NoError(t, DB.AutoMigrate(&SkillTestSession{}))
	var saved SkillTestSession
	require.NoError(t, DB.First(&saved, "id = ?", row.Id).Error)
	require.Equal(t, row.Snapshot, saved.Snapshot)
	require.Equal(t, row.Transcript, saved.Transcript)
	require.Equal(t, row.Events, saved.Events)
}
