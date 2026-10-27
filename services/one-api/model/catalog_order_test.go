package model

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func catalogTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	var db *gorm.DB
	var err error
	if dsn := os.Getenv("CATALOG_TEST_POSTGRES_DSN"); dsn != "" {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		require.NoError(t, err)
		schema := fmt.Sprintf("catalog_%d", time.Now().UnixNano())
		require.NoError(t, db.Exec("CREATE SCHEMA "+schema).Error)
		admin := db
		db, err = gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{})
		t.Cleanup(func() {
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
			sql, _ := admin.DB()
			_ = sql.Close()
		})
	} else {
		db, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	}
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous; sql, _ := db.DB(); _ = sql.Close() })
	return db
}

func TestCatalogMetadataMigrationPreservesInternetChoice(t *testing.T) {
	db := catalogTestDB(t)
	// 模拟升级前已有数据的表，新增列必须补默认值而不是误记为离线技能。
	require.NoError(t, db.Exec("CREATE TABLE skills (id INTEGER PRIMARY KEY, name VARCHAR(100), content TEXT, created_at BIGINT, updated_at BIGINT)").Error)
	require.NoError(t, db.Exec("INSERT INTO skills (id,name,content,created_at,updated_at) VALUES (1,'legacy','body',100,200)").Error)
	require.NoError(t, db.Exec("CREATE TABLE expert_web_profiles (key VARCHAR(80) PRIMARY KEY, name VARCHAR(100), provider VARCHAR(100), workbench_url VARCHAR(2048), provider_secret_hash VARCHAR(64), updated_at BIGINT)").Error)
	require.NoError(t, db.Exec("INSERT INTO expert_web_profiles (key,name,provider,workbench_url,provider_secret_hash,updated_at) VALUES ('legacy-expert','Legacy','test','https://example.com','hash',200)").Error)
	require.NoError(t, db.AutoMigrate(&Skill{}, &ExpertWebProfile{}))
	require.NoError(t, MigrateCatalogMetadata())
	var legacy ExpertWebProfile
	require.NoError(t, db.Where("key = ?", "legacy-expert").First(&legacy).Error)
	require.True(t, *legacy.RequiresInternet)
	require.EqualValues(t, 200, legacy.CreatedAt)
	require.EqualValues(t, 200, legacy.UpdatedAt)
	var skill Skill
	require.NoError(t, db.First(&skill, 1).Error)
	require.NotNil(t, skill.RequiresInternet)
	require.True(t, *skill.RequiresInternet)
	require.Nil(t, skill.SortOrder)
	no := false
	expert := ExpertWebProfile{Key: "offline-expert", Name: "Offline", Provider: "test", WorkbenchURL: "https://example.com", RequiresInternet: &no}
	require.NoError(t, db.Create(&expert).Error)
	require.NoError(t, db.Model(&skill).Update("requires_internet", false).Error)
	require.NoError(t, db.AutoMigrate(&Skill{}, &ExpertWebProfile{}))
	require.NoError(t, MigrateCatalogMetadata())
	require.NoError(t, db.First(&skill, 1).Error)
	require.False(t, *skill.RequiresInternet)
	require.NoError(t, db.First(&expert).Error)
	require.False(t, *expert.RequiresInternet)
}

func TestCatalogCategoryOrderingMatchesPackageAndRelationQueries(t *testing.T) {
	db := catalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&Skill{}, &SkillCategoryType{}, &SkillCategory{}, &SkillCategoryRelation{}, &ExpertCategory{}))
	typ := SkillCategoryType{Code: SkillCategoryTypePackage, Name: "Packages", Status: 1}
	require.NoError(t, db.Create(&typ).Error)
	high := 20
	first := SkillCategory{TypeId: typ.Id, Code: "first", Name: "First", SortOrder: &high, CreatedAt: 1}
	second := SkillCategory{TypeId: typ.Id, Code: "second", Name: "Second", CreatedAt: 200}
	for _, category := range []*SkillCategory{&first, &second} {
		require.NoError(t, CreateSkillCategory(category))
	}
	skill := Skill{Name: "category-skill", Content: "body", Category: first.Name}
	require.NoError(t, db.Create(&skill).Error)
	require.NoError(t, AppendSkillCategories([]int{skill.Id}, []uint64{first.Id, second.Id}))
	packages, err := ListSkillPackages()
	require.NoError(t, err)
	require.Equal(t, first.Id, packages[0].Id)
	relations, err := BatchListSkillCategoriesForSkills([]int{skill.Id})
	require.NoError(t, err)
	require.Equal(t, first.Id, relations[skill.Id][0].Id)
	_, err = ListSkillsForCategory(first.Id)
	require.NoError(t, err)
	_, err = ListSkillsByCategory(first.Code)
	require.NoError(t, err)
	require.NoError(t, MoveCatalogItem("skill-categories", fmt.Sprint(second.Id), fmt.Sprint(first.Id), false))
	categories, err := ListSkillCategoriesByType(SkillCategoryTypePackage, true)
	require.NoError(t, err)
	require.Equal(t, second.Id, categories[0].Id)
	first.SortOrder = nil
	require.NoError(t, UpdateSkillCategory(&first))
	var saved SkillCategory
	require.NoError(t, db.First(&saved, first.Id).Error)
	require.Nil(t, saved.SortOrder)
	one := ExpertCategory{Name: "One"}
	two := ExpertCategory{Name: "Two"}
	require.NoError(t, db.Create(&one).Error)
	require.NoError(t, db.Create(&two).Error)
	require.NoError(t, MoveCatalogItem("expert-categories", fmt.Sprint(one.Id), fmt.Sprint(two.Id), false))
	var experts []ExpertCategory
	require.NoError(t, db.Order(CatalogOrder("")).Find(&experts).Error)
	require.Equal(t, one.Id, experts[0].Id)
}

func TestCatalogOrderAndMovesUseCompleteServerList(t *testing.T) {
	db := catalogTestDB(t)
	require.NoError(t, db.AutoMigrate(&Skill{}, &ExpertCategory{}, &ExpertWebProfile{}))
	zero, high, negative := 0, 10, -3
	for _, item := range []Skill{
		{Name: "empty-old", Content: "body", CreatedAt: 100},
		{Name: "empty-new", Content: "body", CreatedAt: 200},
		{Name: "zero", Content: "body", SortOrder: &zero, CreatedAt: 1},
		{Name: "high", Content: "body", SortOrder: &high, CreatedAt: 1},
		{Name: "negative", Content: "body", SortOrder: &negative, CreatedAt: 1},
	} {
		require.NoError(t, db.Create(&item).Error)
	}
	items, total, err := SearchSkillsWithOptions("", SkillCategoryFilter{}, 1, 20, true, SkillDeletedNormal, "", "")
	require.NoError(t, err)
	require.EqualValues(t, 5, total)
	names := func(items []Skill) string {
		var result []string
		for _, item := range items {
			result = append(result, item.Name)
		}
		return strings.Join(result, ",")
	}
	require.Equal(t, "high,zero,negative,empty-new,empty-old", names(items))
	key := fmt.Sprint(items[4].Id)
	require.NoError(t, MoveCatalogItem("skills", key, fmt.Sprint(items[0].Id), false))
	items, _, err = SearchSkillsWithOptions("", SkillCategoryFilter{}, 1, 2, true, SkillDeletedNormal, "", "")
	require.NoError(t, err)
	require.Equal(t, "empty-old,high", names(items))
	require.Error(t, MoveCatalogItem("skills", key, "99999", false))
	items, _, err = SearchSkillsWithOptions("", SkillCategoryFilter{}, 1, 20, true, SkillDeletedNormal, "", "")
	require.NoError(t, err)
	require.Equal(t, "empty-old,high,zero,negative,empty-new", names(items))
	for _, key := range []string{"alpha-expert", "beta-expert"} {
		require.NoError(t, db.Create(&ExpertWebProfile{Key: key, Name: key, Provider: "test", WorkbenchURL: "https://example.com"}).Error)
	}
	require.NoError(t, MoveCatalogItem("experts", "alpha-expert", "beta-expert", true))
	var experts []ExpertWebProfile
	require.NoError(t, db.Order(CatalogOrder("")).Find(&experts).Error)
	require.Equal(t, "beta-expert", experts[0].Key)
}
