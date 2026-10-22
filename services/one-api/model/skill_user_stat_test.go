package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSkillUserStatsDownloadsAndInstallations(t *testing.T) {
	setupSkillInstallationTestDB(t)
	skill := seedSkill(t, "user-stat", "", false)
	for _, event := range []string{"download-1", "download-1", "download-2"} {
		require.NoError(t, RecordSkillDownload(skill.Id, 7, event, "1.0.0"))
	}
	var row SkillUserStat
	require.NoError(t, DB.First(&row, "user_id = ? AND skill_id = ?", 7, skill.Id).Error)
	require.Equal(t, int64(2), row.DownloadCount)
	require.False(t, row.Installed)
	require.Nil(t, row.FirstInstalledAt)
	counts, err := CountSkillInstallations([]int{skill.Id})
	require.NoError(t, err)
	require.Zero(t, counts[skill.Id])
	require.Error(t, RecordSkillInstallation(skill.Id, 8, "download-1"))
	require.NoError(t, RecordSkillInstallation(skill.Id, 7, "download-1"))
	row = SkillUserStat{}
	require.NoError(t, DB.First(&row, "user_id = ? AND skill_id = ?", 7, skill.Id).Error)
	first := *row.FirstInstalledAt
	require.True(t, row.Installed)
	require.Equal(t, "1.0.0", row.LastInstalledVersion)
	require.NoError(t, RecordSkillInstallation(skill.Id, 7, "download-1"))
	require.NoError(t, RecordSkillDownload(skill.Id, 7, "download-3", "2.0.0"))
	require.NoError(t, RecordSkillInstallation(skill.Id, 7, "download-3"))
	require.NoError(t, RecordSkillDownload(skill.Id, 8, "download-1", "2.0.0"))
	require.NoError(t, RecordSkillInstallation(skill.Id, 8, "download-1"))
	row = SkillUserStat{}
	require.NoError(t, DB.First(&row, "user_id = ? AND skill_id = ?", 7, skill.Id).Error)
	require.Equal(t, int64(3), row.DownloadCount)
	require.True(t, first.Equal(*row.FirstInstalledAt))
	require.Equal(t, "2.0.0", row.LastInstalledVersion)
	counts, err = CountSkillInstallations([]int{skill.Id})
	require.NoError(t, err)
	require.Equal(t, int64(2), counts[skill.Id])
	var stored Skill
	require.NoError(t, DB.First(&stored, skill.Id).Error)
	require.Equal(t, 4, stored.Downloads)
	require.NoError(t, DB.Model(skill).UpdateColumn("is_deleted", true).Error)
	require.NoError(t, RecordSkillInstallation(skill.Id, 7, "download-2"))
	require.Error(t, RecordSkillDownload(skill.Id, 7, "removed", "1.0.0"))
	var events int64
	require.NoError(t, DB.Model(&SkillDownloadEvent{}).Count(&events).Error)
	require.Equal(t, int64(4), events)
}

func TestSkillUserStatsRollbackAndEventMismatch(t *testing.T) {
	setupSkillInstallationTestDB(t)
	skill := seedSkill(t, "stat-rollback", "", false)
	other := seedSkill(t, "stat-other", "", false)
	require.NoError(t, RecordSkillDownload(skill.Id, 7, "one", "1"))
	require.Error(t, RecordSkillDownload(other.Id, 7, "one", "1"))
	require.Error(t, RecordSkillDownload(skill.Id, 7, "one", "2"))
	require.Error(t, RecordSkillDownload(skill.Id, 0, "invalid", "1"))
	require.NoError(t, DB.Migrator().DropTable(&SkillUserStat{}))
	require.Error(t, RecordSkillDownload(skill.Id, 7, "rollback", "1"))
	var stored Skill
	require.NoError(t, DB.First(&stored, skill.Id).Error)
	require.Equal(t, 1, stored.Downloads)
	var n int64
	require.NoError(t, DB.Model(&SkillDownloadEvent{}).Where("event_id = ?", "rollback").Count(&n).Error)
	require.Zero(t, n)
}

func TestSkillUserStatsBackfillRetainsOnlyKnownHistory(t *testing.T) {
	setupSkillInstallationTestDB(t)
	when := time.Now().UTC().Truncate(time.Second)
	// 超过一个迁移批次，确保复合主键的历史表可以完整回填。
	for userID := 1; userID <= 502; userID++ {
		require.NoError(t, DB.Create(&SkillInstallation{SkillID: 123, UserID: userID, InstalledAt: when}).Error)
	}
	require.NoError(t, MigrateSkillUserStats())
	require.NoError(t, MigrateSkillUserStats())
	var rows []SkillUserStat
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 502)
	for _, row := range rows {
		require.True(t, row.Installed)
		require.Zero(t, row.DownloadCount)
		require.Nil(t, row.FirstDownloadedAt)
		require.True(t, when.Equal(*row.FirstInstalledAt))
	}
}
