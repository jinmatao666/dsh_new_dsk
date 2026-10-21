package model

import (
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestListAuthorizedKnowledgeBasesScopesPersonalSharedCommon(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(&KnowledgeBase{}, &KnowledgeBaseGrant{}, &KnowledgeDocumentNote{}, &OrgMember{}, &User{}))

	require.NoError(t, db.Create(&User{Id: 1, Username: "alice", AccessToken: "tok-alice", AffCode: "aff-alice", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "bob", AccessToken: "tok-bob", AffCode: "aff-bob", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&OrgMember{OrgId: 1, UserId: 3, Role: OrgRoleMember, Status: OrgMemberStatusEnabled, DeptId: 9}).Error)
	rows := []KnowledgeBase{
		{Name: "personal-1", RagflowDatasetId: "ds-1", OwnerUserId: 1, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished},
		{Name: "personal-offline", RagflowDatasetId: "ds-2", OwnerUserId: 1, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfOffline},
		{Name: "other-personal", RagflowDatasetId: "ds-3", OwnerUserId: 2, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished},
		{Name: "shared-granted", RagflowDatasetId: "ds-4", OwnerUserId: 2, Kind: KnowledgeBaseShared, Shelf: KnowledgeShelfPublished},
		{Name: "shared-secret", RagflowDatasetId: "ds-5", OwnerUserId: 2, Kind: KnowledgeBaseShared, Shelf: KnowledgeShelfPublished},
		{Name: "common-1", RagflowDatasetId: "ds-6", OwnerUserId: 2, Kind: KnowledgeBaseCommon, Shelf: KnowledgeShelfPublished},
		{Name: "legacy-shelf", RagflowDatasetId: "ds-7", OwnerUserId: 1, Kind: KnowledgeBasePersonal, Shelf: ""},
		{Name: "dept-shared", RagflowDatasetId: "ds-8", OwnerUserId: 2, Kind: KnowledgeBaseShared, Shelf: KnowledgeShelfPublished},
	}
	require.NoError(t, db.Create(&rows).Error)
	var granted, secret, department, otherPersonal KnowledgeBase
	require.NoError(t, db.Where("name = ?", "shared-granted").First(&granted).Error)
	require.NoError(t, db.Where("name = ?", "shared-secret").First(&secret).Error)
	require.NoError(t, db.Where("name = ?", "dept-shared").First(&department).Error)
	require.NoError(t, db.Where("name = ?", "other-personal").First(&otherPersonal).Error)
	require.NoError(t, db.Create(&KnowledgeBaseGrant{KnowledgeBaseId: granted.Id, SubjectType: KnowledgeGrantUser, SubjectId: 1}).Error)
	require.NoError(t, db.Create(&KnowledgeBaseGrant{KnowledgeBaseId: department.Id, SubjectType: KnowledgeGrantDept, SubjectId: 9}).Error)
	require.NoError(t, db.Exec(`UPDATE knowledge_bases SET shelf = NULL WHERE name = ?`, "legacy-shelf").Error)

	visible, err := ListAuthorizedKnowledgeBases(1)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"personal-1", "shared-granted", "legacy-shelf", "common-1"}, namesOf(visible))
	managed, err := ListManagedKnowledgeBases()
	require.NoError(t, err)
	require.Len(t, managed, len(rows))
	require.Equal(t, "alice", ownerName(managed, "personal-1"))
	require.Equal(t, "bob", ownerName(managed, "other-personal"))
	departmentVisible, err := ListAuthorizedKnowledgeBases(3)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"dept-shared", "common-1"}, namesOf(departmentVisible))
	_, err = GetAuthorizedKnowledgeBase(1, secret.Id, false)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	_, err = GetAuthorizedKnowledgeBase(1, otherPersonal.Id, false)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	opened, err := GetAuthorizedKnowledgeBase(1, otherPersonal.Id, true)
	require.NoError(t, err)
	require.Equal(t, "other-personal", opened.Name)

	require.NoError(t, SaveKnowledgeDocumentSummary(granted.Id, "doc-1", "摘要"))
	require.NoError(t, SaveKnowledgeDocumentSummary(granted.Id, "doc-1", "更新摘要"))
	summaries, err := ListKnowledgeDocumentSummaries(granted.Id)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"doc-1": "更新摘要"}, summaries)
	require.NoError(t, DeleteKnowledgeBaseRecords(granted.Id))
	_, err = GetKnowledgeBase(granted.Id)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	remaining, err := ListKnowledgeDocumentSummaries(granted.Id)
	require.NoError(t, err)
	require.Empty(t, remaining)
}

func namesOf(rows []KnowledgeBase) []string {
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		names = append(names, row.Name)
	}
	return names
}

func ownerName(rows []KnowledgeBaseListItem, name string) string {
	for _, row := range rows {
		if row.Name == name {
			return row.OwnerUsername
		}
	}
	return ""
}
