package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestKnowledgePaidDownloadReservesBeforeUpstreamAndReleasesFailure(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "billing.db")), &gorm.Config{})
	require.NoError(t, err)
	oldDB, oldSQLite, oldUnit := model.DB, common.UsingSQLite, config.QuotaPerUnit
	config.OptionMapRWMutex.Lock()
	oldOptions := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"edition":"operations"}`}
	config.OptionMapRWMutex.Unlock()
	model.DB, common.UsingSQLite, config.QuotaPerUnit = db, true, 1000
	t.Cleanup(func() {
		model.DB, common.UsingSQLite, config.QuotaPerUnit = oldDB, oldSQLite, oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldOptions
		config.OptionMapRWMutex.Unlock()
		sql, _ := db.DB()
		sql.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserTimedQuota{}, &model.KnowledgeBase{}, &model.KnowledgeCreditPrice{}, &model.KnowledgeCreditReservation{}, &model.KnowledgeCreditReceipt{}, &model.KnowledgePreviewAccess{}, &model.BillingTask{}, &model.AdminCreditGrant{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "buyer", AffCode: "buyer", AccessToken: "buyer"}).Error)
	require.NoError(t, db.Create(&model.User{Id: 2, Username: "owner", AffCode: "owner", AccessToken: "owner"}).Error)
	base := model.KnowledgeBase{Name: "library", OwnerUserId: 2, Kind: model.KnowledgeBasePersonal, PublicationScope: "subscription", RagflowDatasetId: "dataset"}
	require.NoError(t, db.Create(&base).Error)
	require.NoError(t, model.SaveKnowledgeCreditPrice(2, base.Id, model.KnowledgeCreditPrice{DownloadCents: 100}))
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var buyer model.User
		require.NoError(t, db.First(&buyer, 1).Error)
		require.Zero(t, buyer.Quota)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer upstream.Close()
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test")
	router := gin.New()
	router.POST("/:id/documents/:documentId", func(c *gin.Context) { c.Set("id", 1); c.Set("role", model.RoleRootUser); DownloadKnowledgeDocument(c) })
	run := func(request string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		path := fmt.Sprintf("/%d/documents/file?action=download&expected_cents=100&request_id=%s", base.Id, request)
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, nil))
		return response
	}
	response := run("11111111-1111-4111-8111-111111111111")
	require.Equal(t, http.StatusPaymentRequired, response.Code, response.Body.String())
	require.Zero(t, calls)
	require.NoError(t, model.AddUserTimedQuota(1, 1000, "topup", "test", nil))
	response = run("22222222-2222-4222-8222-222222222222")
	require.Equal(t, http.StatusBadGateway, response.Code, response.Body.String())
	require.Equal(t, 1, calls)
	var buyer model.User
	require.NoError(t, db.First(&buyer, 1).Error)
	require.Equal(t, int64(1000), buyer.Quota)
	var task model.BillingTask
	require.NoError(t, db.First(&task).Error)
	require.Equal(t, "failed", task.State)
	var rewards int64
	require.NoError(t, db.Model(&model.AdminCreditGrant{}).Count(&rewards).Error)
	require.Zero(t, rewards)
}
