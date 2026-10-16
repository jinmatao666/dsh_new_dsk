package model

import "time"

// SkillInstallation retains the first accepted installation per account and skill.
// Uninstalling or replacing a release does not remove this record.
type SkillInstallation struct {
	SkillID     int `gorm:"primaryKey;autoIncrement:false"`
	UserID      int `gorm:"primaryKey;autoIncrement:false"`
	InstalledAt time.Time
}

func CountSkillInstallations(ids []int) (map[int]int64, error) {
	counts := make(map[int]int64, len(ids))
	if len(ids) == 0 {
		return counts, nil
	}
	var rows []struct {
		SkillID int
		Count   int64
	}
	err := DB.Model(&SkillInstallation{}).Select("skill_id, COUNT(*) AS count").Where("skill_id IN ?", ids).Group("skill_id").Scan(&rows).Error
	for _, row := range rows {
		counts[row.SkillID] = row.Count
	}
	return counts, err
}
