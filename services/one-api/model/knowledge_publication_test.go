package model

import (
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
)

func publicationFixture(t *testing.T) (KnowledgeBase, KnowledgeCategory, KnowledgeCategory) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "publication.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(&KnowledgeActivity{}, &KnowledgeBase{}, &KnowledgeCategory{}, &KnowledgePublicationApplication{}, &KnowledgeSubscriptionApplication{}, &KnowledgeBaseGrant{}, &KnowledgeBaseLike{}, &User{}, &OrgMember{}, &GovernmentOrganizationMember{}))
	base := KnowledgeBase{Name: "个人资料", RagflowDatasetId: "publication", OwnerUserId: 7, Kind: KnowledgeBasePersonal, Shelf: KnowledgeShelfPublished}
	require.NoError(t, db.Create(&base).Error)
	public := KnowledgeCategory{Name: "公开资料", Type: KnowledgeBaseCommon}
	subscription := KnowledgeCategory{Name: "专业资料", Type: KnowledgeBaseShared, RequireAuth: true}
	require.NoError(t, SaveKnowledgeCategory(&public))
	require.NoError(t, SaveKnowledgeCategory(&subscription))
	return base, public, subscription
}

func TestKnowledgePublicationApprovalControlsVisibility(t *testing.T) {
	for _, target := range []string{"public", "subscription"} {
		t.Run(target, func(t *testing.T) {
			base, _, _ := publicationFixture(t)
			app, err := ApplyKnowledgePublication(7, base.Id, target, "共享规范")
			require.NoError(t, err)
			require.Equal(t, target, app.Target)
			_, err = ApplyKnowledgePublication(7, base.Id, target, "")
			require.ErrorIs(t, err, ErrKnowledgePublicationPending)
			stored, err := GetKnowledgeBase(base.Id)
			require.NoError(t, err)
			require.Equal(t, KnowledgeBasePersonal, stored.Kind)
			require.Empty(t, stored.PublicationScope)
			ownerBefore, err := ListAuthorizedKnowledgeBases(7)
			require.NoError(t, err)
			require.Len(t, ownerBefore, 1)
			before, err := ListAuthorizedKnowledgeBases(8)
			require.NoError(t, err)
			require.Empty(t, before)
			_, err = GetAuthorizedKnowledgeBase(8, base.Id, false)
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			plazaBefore, err := ListKnowledgePlaza(8, 0, "")
			require.NoError(t, err)
			require.Empty(t, plazaBefore)
			_, err = GetKnowledgePlazaItem(8, base.Id)
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			_, err = ApplyKnowledgeSubscription(8, base.Id)
			require.ErrorIs(t, err, ErrKnowledgeSubscriptionInvalid)
			saved, err := GetKnowledgePublication(base.Id)
			require.NoError(t, err)
			require.Equal(t, KnowledgeSubscriptionPending, saved.Status)
			rows, total, err := ListKnowledgePublications("pending", 1, 20)
			require.NoError(t, err)
			require.EqualValues(t, 1, total)
			require.Len(t, rows, 1)
			reviewed, err := ReviewKnowledgePublication(app.Id, 1, true, "")
			require.NoError(t, err)
			require.Equal(t, KnowledgeSubscriptionApproved, reviewed.Status)
			require.Equal(t, 1, reviewed.ReviewedBy)
			stored, err = GetKnowledgeBase(base.Id)
			require.NoError(t, err)
			require.Zero(t, stored.CategoryId)
			require.Equal(t, KnowledgeBasePersonal, stored.Kind)
			require.Equal(t, target, stored.PublicationScope)
			owner, err := ListAuthorizedKnowledgeBases(7)
			require.NoError(t, err)
			require.Len(t, owner, 1)
			after, err := ListAuthorizedKnowledgeBases(8)
			require.NoError(t, err)
			if target == "public" {
				require.Len(t, after, 1)
				_, err := ApplyKnowledgeSubscription(8, base.Id)
				require.ErrorIs(t, err, ErrKnowledgeSubscriptionInvalid)
			} else {
				require.Empty(t, after)
				plaza, err := ListKnowledgePlaza(8, 0, "")
				require.NoError(t, err)
				require.Len(t, plaza, 1)
				request, err := ApplyKnowledgeSubscription(8, base.Id)
				require.NoError(t, err)
				_, err = ReviewKnowledgeSubscription(request.Id, 1, true)
				require.NoError(t, err)
				after, err = ListAuthorizedKnowledgeBases(8)
				require.NoError(t, err)
				require.Len(t, after, 1)
				require.NoError(t, CancelKnowledgeSubscription(8, base.Id))
				after, err = ListAuthorizedKnowledgeBases(8)
				require.NoError(t, err)
				require.Empty(t, after)
			}
			_, err = ReviewKnowledgePublication(app.Id, 2, false, "重复审核")
			require.ErrorIs(t, err, ErrKnowledgePublicationPending)
		})
	}
}

func TestKnowledgePublicationRejectAndResubmit(t *testing.T) {
	base, _, _ := publicationFixture(t)
	_, err := ApplyKnowledgePublication(8, base.Id, "public", "")
	require.ErrorIs(t, err, ErrKnowledgePublicationInvalid)
	personal := KnowledgeCategory{Name: "私人分类", Type: KnowledgeBasePersonal}
	require.NoError(t, SaveKnowledgeCategory(&personal))
	_, err = ApplyKnowledgePublication(7, base.Id, "invalid", "")
	require.ErrorIs(t, err, ErrKnowledgePublicationInvalid)
	app, err := ApplyKnowledgePublication(7, base.Id, "public", "")
	require.NoError(t, err)
	_, err = ReviewKnowledgePublication(app.Id, 1, false, "")
	require.ErrorIs(t, err, ErrKnowledgePublicationInvalid)
	_, err = ReviewKnowledgePublication(app.Id, 1, false, "请移除私人资料")
	require.NoError(t, err)
	stored, err := GetKnowledgeBase(base.Id)
	require.NoError(t, err)
	require.Equal(t, KnowledgeBasePersonal, stored.Kind)
	require.Empty(t, stored.PublicationScope)
	_, err = GetAuthorizedKnowledgeBase(8, base.Id, false)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	plaza, err := ListKnowledgePlaza(8, 0, "")
	require.NoError(t, err)
	require.Empty(t, plaza)
	again, err := ApplyKnowledgePublication(7, base.Id, "subscription", "已处理")
	require.NoError(t, err)
	require.Equal(t, app.Id, again.Id)
	saved, err := GetKnowledgePublication(base.Id)
	require.NoError(t, err)
	require.Empty(t, saved.ReviewNote)
	require.Nil(t, saved.ReviewedAt)
	require.Zero(t, saved.ReviewedBy)
	require.NoError(t, DB.Model(&base).Update("owner_user_id", 99).Error)
	_, err = ReviewKnowledgePublication(app.Id, 1, true, "")
	require.ErrorIs(t, err, ErrKnowledgePublicationInvalid)
	saved, err = GetKnowledgePublication(base.Id)
	require.NoError(t, err)
	require.Equal(t, KnowledgeSubscriptionPending, saved.Status)
	stored, err = GetKnowledgeBase(base.Id)
	require.NoError(t, err)
	require.Equal(t, KnowledgeBasePersonal, stored.Kind)
}

func TestKnowledgePublicationPreservesPersonalOriginForExistingApprovals(t *testing.T) {
	base, public, _ := publicationFixture(t)
	require.NoError(t, DB.Model(&base).Updates(map[string]interface{}{"kind": KnowledgeBaseCommon, "category_id": public.Id}).Error)
	require.NoError(t, DB.Create(&KnowledgePublicationApplication{KnowledgeBaseId: base.Id, ApplicantUserId: 7, Target: "public", Status: KnowledgeSubscriptionApproved}).Error)
	require.NoError(t, RestorePersonalPublicationOrigins())
	require.NoError(t, RestorePersonalPublicationOrigins())
	saved, err := GetKnowledgeBase(base.Id)
	require.NoError(t, err)
	require.Equal(t, KnowledgeBasePersonal, saved.Kind)
	require.Zero(t, saved.CategoryId)
	require.Equal(t, "public", saved.PublicationScope)
}

func TestKnowledgePublicationWithdrawalRestoresOwnerOnlyAccess(t *testing.T) {
	for _, scope := range []string{"public", "subscription"} {
		t.Run(scope, func(t *testing.T) {
			base, _, _ := publicationFixture(t)
			app, err := ApplyKnowledgePublication(base.OwnerUserId, base.Id, scope, "")
			require.NoError(t, err)
			_, err = ReviewKnowledgePublication(app.Id, 1, true, "")
			require.NoError(t, err)
			if scope == "subscription" {
				subscription, err := ApplyKnowledgeSubscription(9, base.Id)
				require.NoError(t, err)
				_, err = ReviewKnowledgeSubscription(subscription.Id, 1, true)
				require.NoError(t, err)
			}
			require.ErrorIs(t, WithdrawKnowledgePublication(9, base.Id), ErrKnowledgePublicationInvalid)
			require.NoError(t, WithdrawKnowledgePublication(base.OwnerUserId, base.Id))
			require.NoError(t, RestorePersonalPublicationOrigins())
			_, err = GetAuthorizedKnowledgeBase(9, base.Id, false)
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			retained, err := GetAuthorizedKnowledgeBase(base.OwnerUserId, base.Id, false)
			require.NoError(t, err)
			require.Empty(t, retained.PublicationScope)
			_, err = ApplyKnowledgePublication(base.OwnerUserId, base.Id, scope, "")
			require.NoError(t, err)
		})
	}
}
