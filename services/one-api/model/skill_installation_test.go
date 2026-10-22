package model

import (
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupSkillInstallationTestDB(t *testing.T) {
	t.Helper()
	var driver gorm.Dialector = sqlite.Open(":memory:")
	schema := ""
	if dsn := os.Getenv("DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN"); dsn != "" {
		schema = "skill_install_test_" + strconv.FormatInt(time.Now().UnixNano(), 10)
		driver = postgres.Open(dsn + " search_path=" + schema)
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	require.NoError(t, err)
	if schema != "" {
		require.NoError(t, db.Exec("CREATE SCHEMA "+schema).Error)
	}
	previous := DB
	skillCacheLock.Lock()
	previousCache := skillCache
	skillCache = nil
	skillCacheLock.Unlock()
	DB = db
	t.Cleanup(func() {
		if schema != "" {
			_ = db.Exec("DROP SCHEMA " + schema + " CASCADE").Error
		}
		DB = previous
		skillCacheLock.Lock()
		skillCache = previousCache
		skillCacheLock.Unlock()
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&Skill{}, &SkillCategoryType{}, &SkillCategory{}, &SkillCategoryRelation{}))
	require.NoError(t, db.AutoMigrate(&SkillInstallation{}))
	require.NoError(t, MigrateSkillUserStats())
}

func TestSkillDownloadCountsSeparateRepeatedInstallsFromUsers(t *testing.T) {
	setupSkillInstallationTestDB(t)
	require.NoError(t, DB.AutoMigrate(&SkillInstallation{}))
	skill := seedSkill(t, "download-counts", "", false)
	// Historical totals remain intact; they cannot reconstruct account identities.
	require.NoError(t, DB.Model(skill).UpdateColumn("downloads", 5).Error)
	for _, userID := range []int{7, 7, 8} {
		require.NoError(t, IncrementSkillDownloads(skill.Id, userID))
	}
	var stored Skill
	require.NoError(t, DB.First(&stored, skill.Id).Error)
	require.Equal(t, 8, stored.Downloads)
	counts, err := CountSkillInstallations([]int{skill.Id, 999})
	require.NoError(t, err)
	require.Equal(t, int64(2), counts[skill.Id])
	require.Zero(t, counts[999])
	require.Error(t, IncrementSkillDownloads(skill.Id, 0))
	require.Error(t, IncrementSkillDownloads(999, 7))
	require.NoError(t, DB.Model(skill).UpdateColumn("status", 0).Error)
	require.Error(t, IncrementSkillDownloads(skill.Id, 9))
}

func TestSkillDownloadCountsRollbackTogether(t *testing.T) {
	setupSkillInstallationTestDB(t)
	require.NoError(t, DB.Migrator().DropTable(&SkillInstallation{}))
	skill := seedSkill(t, "download-rollback", "", false)
	// Missing installation storage must not increment the desktop total.
	require.Error(t, IncrementSkillDownloads(skill.Id, 7))
	var stored Skill
	require.NoError(t, DB.First(&stored, skill.Id).Error)
	require.Zero(t, stored.Downloads)
}
