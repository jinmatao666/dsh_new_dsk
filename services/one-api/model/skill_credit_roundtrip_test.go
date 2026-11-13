package model

import (
	"encoding/json"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
)

func TestSkillTaskCreditsSaveListReopen(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(&Skill{}))
	skill := Skill{Name: "pvs-bidding-doc", Status: 1}
	require.NoError(t, CreateSkill(&skill))
	for _, credits := range []int64{3, 12, 0} {
		skill.TaskCredits = credits
		require.NoError(t, UpdateSkill(&skill))
		rows, total, err := SearchSkillsWithOptions("", SkillCategoryFilter{}, 1, 20, true, SkillDeletedNormal, "", "")
		require.NoError(t, err)
		require.EqualValues(t, 1, total)
		require.Len(t, rows, 1)
		require.Equal(t, credits, rows[0].TaskCredits)
		encoded, err := json.Marshal(rows[0])
		require.NoError(t, err)
		var response map[string]interface{}
		require.NoError(t, json.Unmarshal(encoded, &response))
		require.Equal(t, float64(credits), response["task_credits"])
		detail, err := GetSkillById(skill.Id)
		require.NoError(t, err)
		require.Equal(t, credits, detail.TaskCredits)
	}
}
