package model

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestListAuthorizedKnowledgeBasesScopesPersonalSharedCommon(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-auth?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(
		&KnowledgeBase{}, &KnowledgeBaseGrant{}, &KnowledgeCategory{}, &KnowledgeSubscriptionApplication{},
		&KnowledgeConversation{}, &KnowledgeDocumentNote{}, &KnowledgeDocumentPath{}, &OrgMember{}, &User{},
	))

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
	// Empty shelf is the pre-migration published state; pure-Go sqlite keeps NOT NULL so NULL is not written.

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

	// Stale personal+require_auth=false rows must not open to everyone; only common+open does.
	leakyPersonal := KnowledgeCategory{Name: "随便建的", Type: KnowledgeBasePersonal, RequireAuth: false}
	openCategory := KnowledgeCategory{Name: "部门规范", Type: KnowledgeBaseCommon, RequireAuth: false}
	closedCategory := KnowledgeCategory{Name: "内部规范", Type: KnowledgeBasePersonal, RequireAuth: true}
	require.NoError(t, SaveKnowledgeCategory(&leakyPersonal))
	require.True(t, leakyPersonal.RequireAuth)
	require.NoError(t, SaveKnowledgeCategory(&openCategory))
	require.False(t, openCategory.RequireAuth)
	require.NoError(t, SaveKnowledgeCategory(&closedCategory))
	require.ErrorIs(t, SaveKnowledgeCategory(&KnowledgeCategory{Name: "部门规范", Type: KnowledgeBaseCommon}), ErrKnowledgeCategoryDuplicate)
	require.Error(t, SaveKnowledgeCategory(&KnowledgeCategory{Name: "", Type: KnowledgeBasePersonal}))
	// Simulate a historical personal category that was stored with require_auth=false.
	require.NoError(t, db.Model(&KnowledgeCategory{}).Where("id = ?", leakyPersonal.Id).Update("require_auth", false).Error)
	categorized := []KnowledgeBase{
		{Name: "open-foreign", RagflowDatasetId: "ds-9", OwnerUserId: 2, Kind: KnowledgeBaseCommon, Shelf: KnowledgeShelfPublished, CategoryId: openCategory.Id},
		{Name: "closed-foreign", RagflowDatasetId: "ds-10", OwnerUserId: 2, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished, CategoryId: closedCategory.Id},
		{Name: "leaky-personal", RagflowDatasetId: "ds-12", OwnerUserId: 2, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished, CategoryId: leakyPersonal.Id},
		{Name: "closed-offline", RagflowDatasetId: "ds-11", OwnerUserId: 1, Kind: KnowledgeBaseCommon, Shelf: KnowledgeShelfOffline, CategoryId: openCategory.Id},
	}
	require.NoError(t, db.Create(&categorized).Error)
	var closedForeign KnowledgeBase
	require.NoError(t, db.Where("name = ?", "closed-foreign").First(&closedForeign).Error)
	require.NoError(t, db.Create(&KnowledgeBaseGrant{KnowledgeBaseId: closedForeign.Id, SubjectType: KnowledgeGrantUser, SubjectId: 1}).Error)
	withCategories, err := ListAuthorizedKnowledgeBases(1)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"personal-1", "shared-granted", "legacy-shelf", "common-1", "open-foreign", "closed-foreign"}, namesOf(withCategories))
	outsider, err := ListAuthorizedKnowledgeBases(3)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"dept-shared", "common-1", "open-foreign"}, namesOf(outsider))
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

func TestKnowledgeSubscriptionApplicationApprovalGrantsAccess(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-subscribe?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(&KnowledgeBase{}, &KnowledgeBaseGrant{}, &KnowledgeCategory{}, &KnowledgeSubscriptionApplication{}, &OrgMember{}, &User{}))
	require.NoError(t, db.Create(&User{Id: 1, Username: "alice", AccessToken: "tok-a", AffCode: "aff-a", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "bob", DisplayName: "鲍勃", AccessToken: "tok-b", AffCode: "aff-b", Role: RoleCommonUser, Status: UserStatusEnabled}).Error)
	category := KnowledgeCategory{Name: "法律", Type: KnowledgeBaseShared, RequireAuth: true}
	require.NoError(t, SaveKnowledgeCategory(&category))
	require.True(t, category.RequireAuth)
	base := KnowledgeBase{
		Name: "地方法规", RagflowDatasetId: "ds-law", OwnerUserId: 2,
		Kind: KnowledgeBaseShared, Shelf: KnowledgeShelfPublished, CategoryId: category.Id,
	}
	require.NoError(t, db.Create(&base).Error)

	personalCategory := KnowledgeCategory{Name: "私货", Type: KnowledgeBasePersonal, RequireAuth: true}
	require.NoError(t, SaveKnowledgeCategory(&personalCategory))
	require.NoError(t, db.Create(&KnowledgeBase{
		Name: "仅自己", RagflowDatasetId: "ds-private", OwnerUserId: 2,
		Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished, CategoryId: personalCategory.Id,
	}).Error)

	plaza, err := ListKnowledgePlaza(1, 0, "")
	require.NoError(t, err)
	require.Len(t, plaza, 1)
	require.Equal(t, "法律", plaza[0].CategoryName)
	require.Equal(t, "地方法规", plaza[0].Name)
	require.Equal(t, "鲍勃", plaza[0].OwnerUsername)
	require.Equal(t, KnowledgeSubscriptionStatusNone, plaza[0].SubscriptionStatus)
	ownerPlaza, err := ListKnowledgePlaza(2, 0, "")
	require.NoError(t, err)
	require.Empty(t, ownerPlaza)

	app, err := ApplyKnowledgeSubscription(1, base.Id)
	require.NoError(t, err)
	require.Equal(t, KnowledgeSubscriptionPending, app.Status)
	_, err = ApplyKnowledgeSubscription(1, base.Id)
	require.ErrorIs(t, err, ErrKnowledgeSubscriptionDuplicate)

	pending, total, err := ListKnowledgeSubscriptionApplications(KnowledgeSubscriptionPending, 1, 20)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, "alice", pending[0].ApplicantUsername)
	require.Equal(t, "地方法规", pending[0].KnowledgeBaseName)

	reviewed, err := ReviewKnowledgeSubscription(app.Id, 2, true)
	require.NoError(t, err)
	require.Equal(t, KnowledgeSubscriptionApproved, reviewed.Status)
	visible, err := ListAuthorizedKnowledgeBases(1)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"地方法规"}, namesOf(visible))
	plazaAfter, err := ListKnowledgePlaza(1, category.Id, "地方")
	require.NoError(t, err)
	require.Empty(t, plazaAfter)

	require.NoError(t, CancelKnowledgeSubscription(1, base.Id))
	visibleAfterCancel, err := ListAuthorizedKnowledgeBases(1)
	require.NoError(t, err)
	require.Empty(t, visibleAfterCancel)
	plazaRestored, err := ListKnowledgePlaza(1, category.Id, "地方")
	require.NoError(t, err)
	require.Len(t, plazaRestored, 1)
	require.Equal(t, KnowledgeSubscriptionStatusNone, plazaRestored[0].SubscriptionStatus)
	_, err = ApplyKnowledgeSubscription(1, base.Id)
	require.NoError(t, err)
}

func TestRecordKnowledgeBaseUsageIncrementsAndResetsDaily(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-usage?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(&KnowledgeBase{}))
	base := KnowledgeBase{
		Name: "stats", RagflowDatasetId: "ds-stats", OwnerUserId: 1,
		Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished,
		DailyUsageDate: "1999-01-01", DailyUsage: 9,
	}
	require.NoError(t, db.Create(&base).Error)

	require.NoError(t, RecordKnowledgeBaseUsage(base.Id))
	var first KnowledgeBase
	require.NoError(t, db.First(&first, base.Id).Error)
	today := knowledgeUsageDay(time.Now())
	require.Equal(t, int64(1), first.VisitCount)
	require.Equal(t, int64(1), first.DailyUsage)
	require.Equal(t, today, first.DailyUsageDate)

	require.NoError(t, RecordKnowledgeBaseUsage(base.Id))
	var second KnowledgeBase
	require.NoError(t, db.First(&second, base.Id).Error)
	require.Equal(t, int64(2), second.VisitCount)
	require.Equal(t, int64(2), second.DailyUsage)
	require.Equal(t, today, second.DailyUsageDate)
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
