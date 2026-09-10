package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupSkillCategoryTestDB(t *testing.T) {
	setupSkillTestDB(t)
	require.NoError(t, ensureDefaultSkillCategoryTypes())
}

func getCategoryTypeId(t *testing.T, code string) uint64 {
	var typ SkillCategoryType
	require.NoError(t, DB.Where("code = ?", code).First(&typ).Error)
	return typ.Id
}

func createSkillCategoryForTest(t *testing.T, typeCode, code, name string) SkillCategory {
	category := SkillCategory{
		TypeId: getCategoryTypeId(t, typeCode),
		Code:   code,
		Name:   name,
		Status: 1,
	}
	require.NoError(t, CreateSkillCategory(&category))
	return category
}

func TestSkillCategoryRelations_allowMultipleTypesAndPackages(t *testing.T) {
	setupSkillCategoryTestDB(t)
	skill := seedSkill(t, "pvs-land-use-analysis", "", false)
	general := createSkillCategoryForTest(t, SkillCategoryTypePackage, "general", "通用技能包")
	planning := createSkillCategoryForTest(t, SkillCategoryTypePackage, "planning-analysis", "规划分析技能包")
	office := createSkillCategoryForTest(t, SkillCategoryTypeFunction, "office-study", "办公学习")

	require.NoError(t, ReplaceSkillCategories(skill.Id, []uint64{general.Id, planning.Id, office.Id}))

	categories, err := ListSkillCategoriesForSkill(skill.Id)
	require.NoError(t, err)
	require.Len(t, categories, 3)
	assert.Equal(t, SkillCategoryTypePackage, categories[0].TypeCode)
	assert.Equal(t, "general", categories[0].Code)
	assert.Equal(t, SkillCategoryTypePackage, categories[1].TypeCode)
	assert.Equal(t, "planning-analysis", categories[1].Code)
	assert.Equal(t, SkillCategoryTypeFunction, categories[2].TypeCode)
	assert.Equal(t, "office-study", categories[2].Code)
}

func TestReplaceSkillCategoriesByType_keepsOtherTypes(t *testing.T) {
	setupSkillCategoryTestDB(t)
	skill := seedSkill(t, "alpha", "", false)
	general := createSkillCategoryForTest(t, SkillCategoryTypePackage, "general", "通用技能包")
	planning := createSkillCategoryForTest(t, SkillCategoryTypePackage, "planning", "规划技能包")
	office := createSkillCategoryForTest(t, SkillCategoryTypeFunction, "office", "办公学习")

	require.NoError(t, ReplaceSkillCategories(skill.Id, []uint64{general.Id, office.Id}))
	require.NoError(t, ReplaceSkillCategoriesByType(skill.Id, SkillCategoryTypePackage, []uint64{planning.Id}))

	categories, err := ListSkillCategoriesForSkill(skill.Id)
	require.NoError(t, err)
	require.Len(t, categories, 2)
	assert.Equal(t, "planning", categories[0].Code)
	assert.Equal(t, "office", categories[1].Code)
}

func TestMigrateLegacySkillCategories(t *testing.T) {
	setupSkillCategoryTestDB(t)
	a := seedSkill(t, "alpha", "doc", false)
	b := seedSkill(t, "beta", "doc", false)
	seedSkill(t, "gamma", "", false)

	require.NoError(t, migrateLegacySkillCategories())
	require.NoError(t, migrateLegacySkillCategories())

	categories, err := ListSkillCategoriesByType(SkillCategoryTypePackage, false)
	require.NoError(t, err)
	require.Len(t, categories, 1)
	assert.Equal(t, "doc", categories[0].Code)

	grouped, err := BatchListSkillCategoriesForSkills([]int{a.Id, b.Id})
	require.NoError(t, err)
	assert.Len(t, grouped[a.Id], 1)
	assert.Len(t, grouped[b.Id], 1)

	var relationCount int64
	require.NoError(t, DB.Model(&SkillCategoryRelation{}).Count(&relationCount).Error)
	assert.Equal(t, int64(2), relationCount)
}

func TestMigrateSkillCategorySchemaCreatesDefaultPrimaryCategory(t *testing.T) {
	setupSkillTestDB(t)

	require.NoError(t, migrateSkillCategorySchema())

	var typ SkillCategoryType
	require.NoError(t, DB.Where("code = ?", SkillCategoryTypePackage).First(&typ).Error)
	var category SkillCategory
	require.NoError(t, DB.Where("type_id = ? AND code = ? AND status = ? AND is_deleted = ?", typ.Id, DefaultSkillCategoryName, 1, false).First(&category).Error)
	assert.Equal(t, DefaultSkillCategoryName, category.Name)
}

func TestMigrateSkillCategorySchemaAcceptsLegacyDefaultCategoryCode(t *testing.T) {
	setupSkillTestDB(t)
	require.NoError(t, DB.AutoMigrate(&SkillCategoryType{}, &SkillCategory{}, &SkillCategoryRelation{}))
	require.NoError(t, ensureDefaultSkillCategoryTypes())
	legacyDefault := SkillCategory{
		TypeId: getCategoryTypeId(t, SkillCategoryTypePackage),
		Code:   "legacy-general",
		Name:   DefaultSkillCategoryName,
		Status: 1,
	}
	require.NoError(t, DB.Create(&legacyDefault).Error)

	require.NoError(t, migrateSkillCategorySchema())
}

func TestListSkillCategoriesByTypeIncludesStatus(t *testing.T) {
	setupSkillCategoryTestDB(t)
	category := createSkillCategoryForTest(t, SkillCategoryTypePackage, "disabled-doc", "禁用分类")
	require.NoError(t, DB.Model(&SkillCategory{}).Where("id = ?", category.Id).Update("status", 0).Error)

	enabledOnly, err := ListSkillCategoriesByType(SkillCategoryTypePackage, false)
	require.NoError(t, err)
	require.Empty(t, enabledOnly)

	categories, err := ListSkillCategoriesByType(SkillCategoryTypePackage, true)
	require.NoError(t, err)
	require.Len(t, categories, 1)
	assert.Equal(t, category.Id, categories[0].Id)
	assert.Equal(t, 0, categories[0].Status)
}

func TestListSkillCategoriesByTypeIncludesSkillCount(t *testing.T) {
	setupSkillCategoryTestDB(t)
	a := seedSkill(t, "alpha", "", false)
	b := seedSkill(t, "beta", "", false)
	deleted := seedSkill(t, "deleted", "", true)
	category := createSkillCategoryForTest(t, SkillCategoryTypePackage, "doc", "文档")

	require.NoError(t, ReplaceSkillCategories(a.Id, []uint64{category.Id}))
	require.NoError(t, ReplaceSkillCategories(b.Id, []uint64{category.Id}))
	require.NoError(t, ReplaceSkillCategories(deleted.Id, []uint64{category.Id}))

	categories, err := ListSkillCategoriesByType(SkillCategoryTypePackage, true)
	require.NoError(t, err)
	require.Len(t, categories, 1)
	assert.Equal(t, category.Id, categories[0].Id)
	assert.Equal(t, 2, categories[0].SkillCount)
}

func TestCategoryAdminViewsUseRelationsInsteadOfLegacyCategoryName(t *testing.T) {
	setupSkillCategoryTestDB(t)
	skill := seedSkill(t, "spatial-analysis", "通用类", false)
	general := createSkillCategoryForTest(t, SkillCategoryTypePackage, "general", "通用类")
	spatial := createSkillCategoryForTest(t, SkillCategoryTypePackage, "spatial", "空间制图")
	require.NoError(t, ReplaceSkillCategories(skill.Id, []uint64{spatial.Id}))

	categories, err := ListSkillCategoriesByType(SkillCategoryTypePackage, true)
	require.NoError(t, err)
	counts := map[uint64]int{}
	for _, category := range categories {
		counts[category.Id] = category.SkillCount
	}
	assert.Zero(t, counts[general.Id])
	assert.Equal(t, 1, counts[spatial.Id])

	generalSkills, err := ListSkillsForCategory(general.Id)
	require.NoError(t, err)
	assert.Empty(t, generalSkills)
	spatialSkills, err := ListSkillsForCategory(spatial.Id)
	require.NoError(t, err)
	require.Len(t, spatialSkills, 1)
	assert.Equal(t, skill.Id, spatialSkills[0].Id)

	count, err := CountSkillCategoryRelations(spatial.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)
}

func TestUpdateSkillCategoryPreservesStableCodeAndType(t *testing.T) {
	setupSkillCategoryTestDB(t)
	general := createSkillCategoryForTest(t, SkillCategoryTypePackage, "general", "通用类")
	spatial := createSkillCategoryForTest(t, SkillCategoryTypePackage, "spatial", "空间制图")

	updated := SkillCategory{
		Id:          general.Id,
		TypeId:      spatial.TypeId,
		Code:        spatial.Code,
		Name:        "默认分类",
		Description: "默认技能分类",
	}
	require.NoError(t, UpdateSkillCategory(&updated))

	var got SkillCategory
	require.NoError(t, DB.First(&got, general.Id).Error)
	assert.Equal(t, general.TypeId, got.TypeId)
	assert.Equal(t, general.Code, got.Code)
	assert.Equal(t, "默认分类", got.Name)
	assert.Equal(t, "默认技能分类", got.Description)
}

func TestMergeDuplicateSkillCategoriesKeepsOneEnabledCategory(t *testing.T) {
	setupSkillCategoryTestDB(t)
	first := createSkillCategoryForTest(t, SkillCategoryTypePackage, "spatial-legacy", "空间制图")
	second := createSkillCategoryForTest(t, SkillCategoryTypePackage, "spatial-current", "空间制图")
	skill := seedSkill(t, "alpha", "", false)
	require.NoError(t, ReplaceSkillCategories(skill.Id, []uint64{second.Id}))

	require.NoError(t, mergeDuplicateSkillCategories())

	categories, err := ListSkillCategoriesByType(SkillCategoryTypePackage, true)
	require.NoError(t, err)
	require.Len(t, categories, 1)
	assert.Equal(t, first.Id, categories[0].Id)
	assert.Equal(t, 1, categories[0].SkillCount)
}

func TestHideRetiredLegacySkillCategoriesHidesDeletedSkillBindings(t *testing.T) {
	setupSkillCategoryTestDB(t)
	category := createSkillCategoryForTest(t, SkillCategoryTypePackage, "retired", "历史分类")
	skill := seedSkill(t, "deleted", "", true)
	require.NoError(t, ReplaceSkillCategories(skill.Id, []uint64{category.Id}))

	require.NoError(t, hideRetiredLegacySkillCategories())

	categories, err := ListSkillCategoriesByType(SkillCategoryTypePackage, true)
	require.NoError(t, err)
	assert.Empty(t, categories)
}

func TestDeleteSkillCategoryRejectsBoundCategory(t *testing.T) {
	setupSkillCategoryTestDB(t)
	skill := seedSkill(t, "alpha", "", false)
	category := createSkillCategoryForTest(t, SkillCategoryTypePackage, "doc", "文档")
	require.NoError(t, ReplaceSkillCategories(skill.Id, []uint64{category.Id}))

	err := DeleteSkillCategory(category.Id)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "请先移除分类下的 skill")

	var got SkillCategory
	require.NoError(t, DB.First(&got, category.Id).Error)
	assert.False(t, got.IsDeleted)
}

func TestSyncPrimarySkillCategoryRejectsUnmanagedCategory(t *testing.T) {
	setupSkillCategoryTestDB(t)
	skill := seedSkill(t, "alpha", "", false)

	err := SyncPrimarySkillCategory(skill.Id, "不存在的分类")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "分类")

	category := createSkillCategoryForTest(t, SkillCategoryTypePackage, "mapping", "空间制图")
	require.NoError(t, SyncPrimarySkillCategory(skill.Id, category.Name))
	categories, err := ListSkillCategoriesForSkill(skill.Id)
	require.NoError(t, err)
	require.Len(t, categories, 1)
	assert.Equal(t, category.Id, categories[0].Id)
}

func TestSearchSkillsWithCategoryFilter(t *testing.T) {
	setupSkillCategoryTestDB(t)
	a := seedSkill(t, "alpha", "", false)
	seedSkill(t, "beta", "", false)
	office := createSkillCategoryForTest(t, SkillCategoryTypeFunction, "office", "办公学习")
	require.NoError(t, ReplaceSkillCategories(a.Id, []uint64{office.Id}))

	skills, total, err := SearchSkillsWithCategoryFilter("", SkillCategoryFilter{
		CategoryType: SkillCategoryTypeFunction,
		CategoryCode: "office",
	}, 1, 20, false, false)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "alpha", skills[0].Name)
}
