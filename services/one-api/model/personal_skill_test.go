package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&PersonalSkill{}))
	DB = db
}

func TestSearchPersonalSkills_OwnerFilter(t *testing.T) {
	setupTestDB(t)
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "alpha", Owner: "alice", Content: "x"}))
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "beta", Owner: "bob", Content: "x"}))

	skills, total, err := SearchPersonalSkills("", "alice", 1, 20)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "alpha", skills[0].Name)
}

func TestSearchPersonalSkills_KeywordMatchesNameDescOwner(t *testing.T) {
	setupTestDB(t)
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "alpha", Description: "search me", Owner: "alice", Content: "x"}))
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "search-this", Owner: "bob", Content: "x"}))
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "gamma", Owner: "search-user", Content: "x"}))
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "delta", Owner: "carol", Content: "x"}))

	skills, total, err := SearchPersonalSkills("search", "", 1, 20)
	assert.NoError(t, err)
	assert.Equal(t, int64(3), total)
	names := []string{}
	for _, s := range skills {
		names = append(names, s.Name)
	}
	assert.ElementsMatch(t, []string{"alpha", "search-this", "gamma"}, names)
}

func TestSearchPersonalSkills_OwnerAndKeywordCombined(t *testing.T) {
	setupTestDB(t)
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "alpha", Owner: "alice", Content: "x"}))
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "alpha", Owner: "bob", Content: "x"}))
	assert.NoError(t, CreatePersonalSkill(&PersonalSkill{Name: "beta", Owner: "alice", Content: "x"}))

	skills, total, err := SearchPersonalSkills("alpha", "alice", 1, 20)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "alice", skills[0].Owner)
}

func TestSearchPersonalSkillsSorted_sortsAcrossPagesBeforePagination(t *testing.T) {
	setupTestDB(t)
	records := []struct {
		name      string
		updatedAt int64
	}{
		{name: "oldest", updatedAt: 100},
		{name: "older", updatedAt: 200},
		{name: "middle", updatedAt: 300},
		{name: "newer", updatedAt: 400},
		{name: "newest", updatedAt: 500},
	}
	for _, record := range records {
		skill := &PersonalSkill{Name: record.name, Owner: "alice", Content: "x"}
		require.NoError(t, CreatePersonalSkill(skill))
		require.NoError(t, DB.Model(&PersonalSkill{}).Where("id = ?", skill.Id).Update("updated_at", record.updatedAt).Error)
	}

	firstPage, total, err := SearchPersonalSkillsSorted("", "", 1, 2, "updated_at", "desc")
	require.NoError(t, err)
	assert.Equal(t, int64(5), total)
	require.Len(t, firstPage, 2)
	assert.Equal(t, "newest", firstPage[0].Name)
	assert.Equal(t, "newer", firstPage[1].Name)

	secondPage, _, err := SearchPersonalSkillsSorted("", "", 2, 2, "updated_at", "desc")
	require.NoError(t, err)
	require.Len(t, secondPage, 2)
	assert.Equal(t, "middle", secondPage[0].Name)
	assert.Equal(t, "older", secondPage[1].Name)
}
