package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestListAuthorizedKnowledgeBasesExcludesOrgColleaguePersonal(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-org-peer?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(
		&KnowledgeBase{}, &KnowledgeBaseGrant{}, &KnowledgeCategory{},
		&GovernmentOrganizationNode{}, &GovernmentOrganizationMember{}, &OrgMember{}, &User{},
	))
	require.NoError(t, db.Create(&User{Id: 1, Username: "yxh", AccessToken: "t1", AffCode: "a1", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "jmt", AccessToken: "t2", AffCode: "a2", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&User{Id: 3, Username: "admin", AccessToken: "t3", AffCode: "a3", Role: RoleRootUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationNode{ID: 1, Name: "产品部", ParentID: 0}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationNode{ID: 2, Name: "总部", ParentID: 0}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationMember{UserID: 1, NodeID: 1}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationMember{UserID: 2, NodeID: 1}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationMember{UserID: 3, NodeID: 2}).Error)
	require.NoError(t, db.Create(&KnowledgeBase{
		Name: "yxh-notes", RagflowDatasetId: "ds-1", OwnerUserId: 1, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished,
	}).Error)
	require.NoError(t, db.Create(&KnowledgeBase{
		Name: "jmt-notes", RagflowDatasetId: "ds-2", OwnerUserId: 2, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished,
	}).Error)
	require.NoError(t, db.Create(&KnowledgeBase{
		Name: "admin-notes", RagflowDatasetId: "ds-3", OwnerUserId: 3, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished,
	}).Error)

	visible, err := ListAuthorizedKnowledgeBases(1)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"yxh-notes"}, namesOf(visible))
	require.NotContains(t, namesOf(visible), "jmt-notes")
	require.NotContains(t, namesOf(visible), "admin-notes")
}

func TestListKnowledgeCategoriesForUserByOwnerNotByName(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-cat-owner?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(
		&KnowledgeBase{}, &KnowledgeBaseGrant{}, &KnowledgeCategory{},
		&GovernmentOrganizationMember{}, &OrgMember{}, &User{},
	))
	require.NoError(t, db.Create(&User{Id: 1, Username: "alice", AccessToken: "t1", AffCode: "a1", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "bob", AccessToken: "t2", AffCode: "a2", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)

	mine := KnowledgeCategory{Name: "部门资料", Type: KnowledgeBaseShared, OwnerUserId: 1}
	theirs := KnowledgeCategory{Name: "授权知识库", Type: KnowledgeBaseShared, OwnerUserId: 2}
	open := KnowledgeCategory{Name: "公开规范", Type: KnowledgeBaseCommon, OwnerUserId: 2}
	require.NoError(t, SaveKnowledgeCategory(&mine))
	require.NoError(t, SaveKnowledgeCategory(&theirs))
	require.NoError(t, SaveKnowledgeCategory(&open))

	forUser, err := ListKnowledgeCategoriesForUser(1, false)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"部门资料", "公开规范"}, categoryNames(forUser))

	rootAll, err := ListKnowledgeCategoriesForUser(1, true)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"部门资料", "授权知识库", "公开规范"}, categoryNames(rootAll))

	require.True(t, CanManageKnowledgeCategory(&mine, 1, false))
	require.False(t, CanManageKnowledgeCategory(&theirs, 1, false))
	require.True(t, CanManageKnowledgeCategory(&theirs, 1, true))
}

func TestListKnowledgeOrganizationDirectoryScopesToSelfOnMembershipPath(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-org-directory?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(&GovernmentOrganizationNode{}, &GovernmentOrganizationMember{}, &User{}))
	require.NoError(t, db.Create(&User{Id: 1, Username: "yxh", AccessToken: "t1", AffCode: "a1", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "jmt", AccessToken: "t2", AffCode: "a2", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&User{Id: 3, Username: "other", AccessToken: "t3", AffCode: "a3", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationNode{ID: 1, Name: "公司", ParentID: 0}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationNode{ID: 2, Name: "产品部", ParentID: 1}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationNode{ID: 3, Name: "市场部", ParentID: 1}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationMember{UserID: 1, NodeID: 2}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationMember{UserID: 2, NodeID: 2}).Error)
	require.NoError(t, db.Create(&GovernmentOrganizationMember{UserID: 3, NodeID: 3}).Error)

	directory, err := ListKnowledgeOrganizationDirectory(1)
	require.NoError(t, err)
	names := make([]string, 0, len(directory.Nodes))
	for _, node := range directory.Nodes {
		names = append(names, node.Name)
	}
	require.ElementsMatch(t, []string{"公司", "产品部"}, names)
	require.NotContains(t, names, "市场部")
	userNames := make([]string, 0, len(directory.Users))
	for _, user := range directory.Users {
		userNames = append(userNames, user.Username)
	}
	require.Equal(t, []string{"yxh"}, userNames)
	require.Len(t, directory.Memberships, 1)
	require.Equal(t, 1, directory.Memberships[0].UserID)
	require.EqualValues(t, 2, directory.Memberships[0].NodeID)
}

func categoryNames(rows []KnowledgeCategory) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.Name)
	}
	return out
}
