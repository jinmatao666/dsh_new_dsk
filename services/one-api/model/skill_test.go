package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 复用 personal_skill_test.go 的 sqlite 内存库模式;Skill 单独建库避免污染
func setupSkillTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	assert.NoError(t, err)
	assert.NoError(t, db.AutoMigrate(&Skill{}))
	assert.NoError(t, db.AutoMigrate(&SkillCategoryType{}, &SkillCategory{}, &SkillCategoryRelation{}))
	DB = db
}

// 种子工具:批量造数据
func seedSkill(t *testing.T, name, category string, isDeleted bool) *Skill {
	s := &Skill{
		Name:      name,
		Category:  category,
		Content:   "x",
		Status:    1,
		IsDeleted: isDeleted,
	}
	assert.NoError(t, CreateSkill(s))
	return s
}

func TestSearchSkills_filtersDeleted(t *testing.T) {
	setupSkillTestDB(t)
	seedSkill(t, "alpha", "", false)
	seedSkill(t, "beta", "", true) // 软删

	skills, total, err := SearchSkills("", "", 1, 20, false, false)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "alpha", skills[0].Name)
}

func TestAdminSearchSkills_includeDeleted(t *testing.T) {
	setupSkillTestDB(t)
	seedSkill(t, "alpha", "", false)
	seedSkill(t, "beta", "", true)

	// admin 列表:includeDisabled=true & includeDeleted=true 看到全部
	skills, total, err := SearchSkills("", "", 1, 20, true, true)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, skills, 2)
}

func TestSearchSkillsWithOptions_sortsAcrossPagesBeforePagination(t *testing.T) {
	setupSkillTestDB(t)
	records := []struct {
		name      string
		downloads int
		updatedAt int64
	}{
		{name: "old-popular", downloads: 100, updatedAt: 100},
		{name: "older", downloads: 80, updatedAt: 200},
		{name: "middle", downloads: 60, updatedAt: 300},
		{name: "newer", downloads: 10, updatedAt: 400},
		{name: "newest-unpopular", downloads: 0, updatedAt: 500},
	}
	for _, record := range records {
		skill := seedSkill(t, record.name, "", false)
		require.NoError(t, DB.Model(&Skill{}).Where("id = ?", skill.Id).Updates(map[string]interface{}{
			"downloads":  record.downloads,
			"updated_at": record.updatedAt,
		}).Error)
	}

	firstPage, total, err := SearchSkillsWithOptions("", SkillCategoryFilter{}, 1, 2, true, SkillDeletedNormal, "updated_at", "desc")
	require.NoError(t, err)
	assert.Equal(t, int64(5), total)
	require.Len(t, firstPage, 2)
	assert.Equal(t, "newest-unpopular", firstPage[0].Name)
	assert.Equal(t, "newer", firstPage[1].Name)

	secondPage, _, err := SearchSkillsWithOptions("", SkillCategoryFilter{}, 2, 2, true, SkillDeletedNormal, "updated_at", "desc")
	require.NoError(t, err)
	require.Len(t, secondPage, 2)
	assert.Equal(t, "middle", secondPage[0].Name)
	assert.Equal(t, "older", secondPage[1].Name)
}

func TestSearchSkillsWithOptions_deletedOnly(t *testing.T) {
	setupSkillTestDB(t)
	seedSkill(t, "normal", "", false)
	seedSkill(t, "deleted", "", true)

	skills, total, err := SearchSkillsWithOptions("", SkillCategoryFilter{}, 1, 20, true, SkillDeletedOnly, "updated_at", "desc")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, skills, 1)
	assert.Equal(t, "deleted", skills[0].Name)
}

func TestSkillSearchListQueryDoesNotInheritDistinctFromCount(t *testing.T) {
	db, err := gorm.Open(postgres.Open("host=localhost user=test dbname=test sslmode=disable"), &gorm.Config{
		DryRun:               true,
		DisableAutomaticPing: true,
	})
	require.NoError(t, err)
	DB = db

	countQuery := buildSkillSearchQuery("", SkillCategoryFilter{}, true, SkillDeletedNormal)
	var total int64
	countQuery = countQuery.Distinct("skills.id").Count(&total)
	require.NoError(t, countQuery.Error)
	assert.Contains(t, strings.ToUpper(countQuery.Statement.SQL.String()), "COUNT(DISTINCT")

	var skills []Skill
	listQuery := buildSkillSearchQuery("", SkillCategoryFilter{}, true, SkillDeletedNormal).
		Select(skillListSelectColumns).
		Find(&skills)

	require.NoError(t, listQuery.Error)
	assert.False(t, listQuery.Statement.Distinct)
	assert.NotContains(t, strings.ToUpper(listQuery.Statement.SQL.String()), "SELECT DISTINCT")
	assert.Contains(t, listQuery.Statement.SQL.String(), "skills.tags")
}

func TestSearchSkills_filtersByCategory(t *testing.T) {
	setupSkillTestDB(t)
	seedSkill(t, "alpha", "doc", false)
	seedSkill(t, "beta", "dev", false)
	seedSkill(t, "gamma", "doc", false)

	skills, total, err := SearchSkills("", "doc", 1, 20, false, false)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	for _, s := range skills {
		assert.Equal(t, "doc", s.Category)
	}
}

func TestDeleteSkill_softDeleteIdempotent(t *testing.T) {
	setupSkillTestDB(t)
	s := seedSkill(t, "alpha", "", false)

	affected, err := DeleteSkill(s.Id)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), affected)

	// 再次软删:GORM Update 会匹配到行但值未变,返回 affected=0
	affected2, err := DeleteSkill(s.Id)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), affected2)

	// 验证默认查询过滤掉
	_, total, err := SearchSkills("", "", 1, 20, false, false)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
}

func TestRestoreSkill(t *testing.T) {
	setupSkillTestDB(t)
	s := seedSkill(t, "alpha", "", true)

	affected, err := RestoreSkill(s.Id)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), affected)

	got, err := GetSkillById(s.Id)
	assert.NoError(t, err)
	assert.False(t, got.IsDeleted)
}

func TestBatchUpdateSkills_softDelete(t *testing.T) {
	setupSkillTestDB(t)
	a := seedSkill(t, "a", "", false)
	b := seedSkill(t, "b", "", false)
	c := seedSkill(t, "c", "", false)

	affected, err := BatchUpdateSkills([]int{a.Id, b.Id, c.Id}, SkillBatchSoftDelete, "")
	assert.NoError(t, err)
	assert.Equal(t, int64(3), affected)

	_, total, err := SearchSkills("", "", 1, 20, false, false)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), total)
}

func TestBatchUpdateSkills_setCategory(t *testing.T) {
	setupSkillTestDB(t)
	a := seedSkill(t, "a", "", false)
	b := seedSkill(t, "b", "old", false)

	affected, err := BatchUpdateSkills([]int{a.Id, b.Id}, SkillBatchSetCategory, "new-cat")
	assert.NoError(t, err)
	assert.Equal(t, int64(2), affected)

	got, _ := GetSkillById(a.Id)
	assert.Equal(t, "new-cat", got.Category)
	got2, _ := GetSkillById(b.Id)
	assert.Equal(t, "new-cat", got2.Category)
}

func TestBatchUpdateSkills_invalidAction(t *testing.T) {
	setupSkillTestDB(t)
	a := seedSkill(t, "a", "", false)

	affected, err := BatchUpdateSkills([]int{a.Id}, SkillBatchAction("nope"), "")
	assert.NoError(t, err)
	assert.Equal(t, int64(0), affected)
}

func TestListSkillCategories_deduplicated(t *testing.T) {
	setupSkillTestDB(t)
	seedSkill(t, "a", "doc", false)
	seedSkill(t, "b", "doc", false)
	seedSkill(t, "c", "dev", false)
	seedSkill(t, "d", "", false)       // 空 category 应被排除
	seedSkill(t, "e", "deleted", true) // 软删的应被排除

	cats, err := ListSkillCategories()
	assert.NoError(t, err)
	assert.ElementsMatch(t, []string{"dev", "doc"}, cats)
}

func TestGetSkillByNameAny_findsDeleted(t *testing.T) {
	setupSkillTestDB(t)
	s := seedSkill(t, "alpha", "", true)

	got, err := GetSkillByNameAny("alpha")
	assert.NoError(t, err)
	assert.Equal(t, s.Id, got.Id)
	assert.True(t, got.IsDeleted)
}

func TestHardDeleteSkill(t *testing.T) {
	setupSkillTestDB(t)
	s := seedSkill(t, "alpha", "", false)

	assert.NoError(t, HardDeleteSkill(s.Id))

	_, err := GetSkillById(s.Id)
	assert.Error(t, err) // 物理删后 First 应找不到
}

func TestGetVisibleSkillById_filtersDisabledAndDeleted(t *testing.T) {
	setupSkillTestDB(t)

	// 正常公开技能：带 body/assets，应能原样取回。
	normal := &Skill{
		Name:      "normal",
		Content:   "legacy",
		Body:      "正文",
		Assets:    "<!-- file: a.py -->\n```python\nprint(1)\n```",
		Status:    1,
		IsDeleted: false,
	}
	assert.NoError(t, CreateSkill(normal))

	disabled := &Skill{Name: "disabled", Content: "x", Status: 1, IsDeleted: false}
	assert.NoError(t, CreateSkill(disabled))
	// GORM 的 `default:1` tag 会在插入时把零值 Status 覆盖成 1，故先正常建库，
	// 再用 UPDATE 置 0——这正是线上禁用技能的实际路径（admin 改 status）。
	assert.NoError(t, DB.Model(&Skill{}).Where("id = ?", disabled.Id).Update("status", 0).Error)

	deleted := seedSkill(t, "deleted", "", true) // status=1 但软删

	// 正常技能：命中，且 body/assets 完整（bundle 靠这两段返回内容）。
	got, err := GetVisibleSkillById(normal.Id)
	assert.NoError(t, err)
	assert.Equal(t, normal.Id, got.Id)
	assert.Equal(t, "正文", got.Body)
	assert.NotEmpty(t, got.Assets)

	// 已禁用（status=0）：not found。
	_, err = GetVisibleSkillById(disabled.Id)
	assert.Error(t, err)

	// 已软删（is_deleted=true）：not found。
	_, err = GetVisibleSkillById(deleted.Id)
	assert.Error(t, err)

	// 不存在的 id：not found。
	_, err = GetVisibleSkillById(999999)
	assert.Error(t, err)
}
