package model

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func knowledgeCreditFixture(t *testing.T, initial int64) KnowledgeBase {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "credits.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	previous, sqliteMode, unit := DB, common.UsingSQLite, config.QuotaPerUnit
	config.OptionMapRWMutex.Lock()
	options := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"edition":"operations"}`}
	config.OptionMapRWMutex.Unlock()
	DB, common.UsingSQLite, config.QuotaPerUnit = db, true, 1000
	t.Cleanup(func() {
		DB, common.UsingSQLite, config.QuotaPerUnit = previous, sqliteMode, unit
		config.OptionMapRWMutex.Lock()
		config.OptionMap = options
		config.OptionMapRWMutex.Unlock()
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&User{}, &UserTimedQuota{}, &KnowledgeBase{}, &KnowledgeCreditPrice{}, &KnowledgeCreditReceipt{}, &KnowledgePreviewAccess{}, &KnowledgeCreditQuestion{}, &KnowledgeConversation{}))
	require.NoError(t, db.Create(&User{Id: 1, Username: "subscriber", AffCode: "buyer", AccessToken: "buyer-token"}).Error)
	require.NoError(t, db.Create(&User{Id: 2, Username: "maintainer", AffCode: "owner", AccessToken: "owner-token"}).Error)
	require.NoError(t, AddUserTimedQuota(1, initial, "topup", "test", nil))
	base := KnowledgeBase{OwnerUserId: 2, Name: "资料库", Kind: KnowledgeBasePersonal, PublicationScope: "subscription", RagflowDatasetId: "credit-ds"}
	require.NoError(t, db.Create(&base).Error)
	require.NoError(t, SaveKnowledgeCreditPrice(2, base.Id, KnowledgeCreditPrice{BrowseCents: 101, QuestionCents: 101, DownloadCents: 300}))
	return base
}

func creditBalances(t *testing.T, buyer, owner int64) {
	t.Helper()
	var users []User
	require.NoError(t, DB.Order("id").Find(&users).Error)
	require.Len(t, users, 2)
	require.Equal(t, buyer, users[0].Quota)
	require.Equal(t, owner, users[1].Quota)
}

func TestKnowledgeCreditPreviewWindowAndDownloadReplay(t *testing.T) {
	base := knowledgeCreditFixture(t, 20000)
	terms, err := ReadKnowledgeCreditTerms(&base, 1)
	require.NoError(t, err)
	require.NotNil(t, terms)
	doc := []KnowledgeCreditDocument{{Id: "file-1", Name: "文件"}}
	receipts, err := SettleKnowledgeCredits(1, &base, terms, "browse", "a", doc, "", "")
	require.NoError(t, err)
	require.Len(t, receipts, 1)
	require.Equal(t, int64(71), receipts[0].OwnerCents)
	require.Equal(t, int64(30), receipts[0].PlatformCents)
	until, err := KnowledgePreviewPaidUntil(1, base.Id, "file-1")
	require.NoError(t, err)
	receipts, err = SettleKnowledgeCredits(1, &base, terms, "browse", "b", doc, "", "")
	require.NoError(t, err)
	require.Empty(t, receipts)
	after, err := KnowledgePreviewPaidUntil(1, base.Id, "file-1")
	require.NoError(t, err)
	require.True(t, after.Equal(until))
	require.NoError(t, DB.Model(&KnowledgePreviewAccess{}).Where("user_id = ?", 1).Update("paid_until", time.Now().Add(-time.Minute)).Error)
	receipts, err = SettleKnowledgeCredits(1, &base, terms, "browse", "c", doc, "", "")
	require.NoError(t, err)
	require.Len(t, receipts, 1)
	first, err := SettleKnowledgeCredits(1, &base, terms, "download", "d", doc, "", "")
	require.NoError(t, err)
	replay, err := SettleKnowledgeCredits(1, &base, terms, "download", "d", doc, "", "")
	require.NoError(t, err)
	require.Equal(t, first[0].Id, replay[0].Id)
	creditBalances(t, 14980, 3520)
}

func TestKnowledgeCreditQuestionAtomicAndDeduplicated(t *testing.T) {
	base := knowledgeCreditFixture(t, 1500)
	terms, err := ReadKnowledgeCreditTerms(&base, 1)
	require.NoError(t, err)
	conversation := KnowledgeConversation{UserId: 1, KnowledgeBaseId: base.Id, RagflowChatId: "chat", RagflowSessionId: "session", Model: "model"}
	require.NoError(t, DB.Create(&conversation).Error)
	question := KnowledgeCreditQuestion{Key: "question-key", UserId: 1, BaseId: base.Id, SessionId: "session", Fingerprint: "question"}
	_, err = BeginKnowledgeCreditQuestion(&question, conversation.Id)
	require.NoError(t, err)
	documents := []KnowledgeCreditDocument{{Id: "file-a"}, {Id: "file-a"}, {Id: "file-b"}}
	_, err = SettleKnowledgeCredits(1, &base, terms, "question", "q", documents, question.Key, `{"answer":"done"}`)
	require.ErrorContains(t, err, "积分余额不足")
	creditBalances(t, 1500, 0)
	var count int64
	require.NoError(t, DB.Model(&KnowledgeCreditReceipt{}).Count(&count).Error)
	require.Zero(t, count)
	pending, err := KnowledgeCreditQuestionPending("session")
	require.NoError(t, err)
	require.True(t, pending)
	require.NoError(t, AddUserTimedQuota(1, 5000, "topup", "retry", nil))
	receipts, err := SettleKnowledgeCredits(1, &base, terms, "question", "q", documents, question.Key, `{"answer":"done"}`)
	require.NoError(t, err)
	require.Len(t, receipts, 2)
	require.Equal(t, int64(141), receipts[0].OwnerCents+receipts[1].OwnerCents)
	creditBalances(t, 4480, 1410)
	replay, err := BeginKnowledgeCreditQuestion(&question, conversation.Id)
	require.NoError(t, err)
	require.JSONEq(t, `{"answer":"done"}`, replay)
}

func TestKnowledgeCreditOnlyOperationsSubscribers(t *testing.T) {
	base := knowledgeCreditFixture(t, 1000)
	owner, err := ReadKnowledgeCreditTerms(&base, 2)
	require.NoError(t, err)
	require.Nil(t, owner)
	public := base
	public.PublicationScope = "public"
	terms, err := ReadKnowledgeCreditTerms(&public, 1)
	require.NoError(t, err)
	require.Nil(t, terms)
	config.OptionMapRWMutex.Lock()
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"government","billing":{"enabled":true}}`
	config.OptionMapRWMutex.Unlock()
	terms, err = ReadKnowledgeCreditTerms(&base, 1)
	require.NoError(t, err)
	require.Nil(t, terms)
}

func TestKnowledgeCreditLimitsApplyToNewPricesAndExistingCharges(t *testing.T) {
	base := knowledgeCreditFixture(t, 20000)
	require.NoError(t, DB.AutoMigrate(&Option{}))
	settings := KnowledgeCreditSettings{Percent: 25, Limits: KnowledgeCreditLimits{BrowseCents: 50, QuestionCents: 75, DownloadCents: 0}}
	require.NoError(t, SaveKnowledgeCreditSettings(settings))
	stored, err := ReadKnowledgeCreditSettings()
	require.NoError(t, err)
	require.Equal(t, settings, stored)
	require.Error(t, SaveKnowledgeCreditPrice(2, base.Id, KnowledgeCreditPrice{BrowseCents: 51}))
	terms, err := ReadKnowledgeCreditTerms(&base, 1)
	require.NoError(t, err)
	require.Equal(t, int64(50), terms.Price.BrowseCents)
	require.Equal(t, int64(75), terms.Price.QuestionCents)
	require.Zero(t, terms.Price.DownloadCents)
	require.Equal(t, 25, terms.PlatformPercent)
}
