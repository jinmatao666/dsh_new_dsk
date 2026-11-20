package controller

import (
	"bytes"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
)

func TestKnowledgePublicationRequiresOperationsEdition(t *testing.T) {
	config.OptionMapRWMutex.Lock()
	previous := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"network":"internet","edition":"government"}`}
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		config.OptionMapRWMutex.Lock()
		config.OptionMap = previous
		config.OptionMapRWMutex.Unlock()
	})
	for _, handler := range []gin.HandlerFunc{ApplyKnowledgePublication, ReviewManagedKnowledgePublication} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("role", model.RoleAdminUser)
		c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
		handler(c)
		require.Equal(t, http.StatusForbidden, recorder.Code)
	}
}

func TestKnowledgeReviewRejectsNonAdministratorsBeforeReadingData(t *testing.T) {
	for _, role := range []int{0, model.RoleCommonUser} {
		for _, handler := range []gin.HandlerFunc{ListManagedKnowledgePublications, ReviewManagedKnowledgePublication, ListManagedKnowledgeSubscriptionApplications, ReviewManagedKnowledgeSubscription} {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("role", role)
			c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
			handler(c)
			require.Equal(t, http.StatusForbidden, recorder.Code)
		}
	}
}

func TestKnowledgePublicationHTTPWorkflow(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "review.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeActivity{}, &model.KnowledgeBase{}, &model.KnowledgeCategory{}, &model.KnowledgePublicationApplication{}, &model.KnowledgeCreditPrice{}, &model.KnowledgeBaseGrant{}, &model.OrgMember{}, &model.GovernmentOrganizationMember{}, &model.User{}, &model.KnowledgeSubscriptionApplication{}, &model.KnowledgeBaseLike{}))
	config.OptionMapRWMutex.Lock()
	previousOptions := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"network":"internet","edition":"operations"}`}
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		config.OptionMapRWMutex.Lock()
		config.OptionMap = previousOptions
		config.OptionMapRWMutex.Unlock()
	})
	base := model.KnowledgeBase{Name: "个人库", OwnerUserId: 7, Kind: model.KnowledgeBasePersonal, Shelf: model.KnowledgeShelfPublished, RagflowDatasetId: "http-publish"}
	require.NoError(t, db.Create(&base).Error)
	category := model.KnowledgeCategory{Name: "管理员的订阅分类", Type: model.KnowledgeBaseShared, RequireAuth: true, OwnerUserId: 1}
	require.NoError(t, model.SaveKnowledgeCategory(&category))
	categorized := model.KnowledgeBase{Name: "直接创建的订阅库", OwnerUserId: 7, Kind: model.KnowledgeBaseShared, CategoryId: category.Id, Shelf: model.KnowledgeShelfPublished, RagflowDatasetId: "categorized"}
	require.NoError(t, db.Create(&categorized).Error)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		id, _ := strconv.Atoi(c.GetHeader("Test-User"))
		role, _ := strconv.Atoi(c.GetHeader("Test-Role"))
		c.Set("id", id)
		c.Set("role", role)
		c.Next()
	})
	engine.GET("/bases/:id/publication", GetKnowledgePublication)
	engine.GET("/bases/credit-prices", ListOwnedKnowledgeCreditPrices)
	engine.PUT("/bases/:id/credit-price", PutKnowledgeCreditPrice)
	engine.POST("/bases/:id/publication", ApplyKnowledgePublication)
	engine.POST("/reviews/:id", ReviewManagedKnowledgePublication)
	engine.GET("/bases/:id/documents", ListKnowledgeDocuments)
	engine.GET("/bases/:id/documents/:documentId/file", DownloadKnowledgeDocument)
	engine.GET("/bases/:id/documents/:documentId/chunks", ListKnowledgeDocumentChunks)
	engine.GET("/bases/:id/documents/:documentId/cover", GetKnowledgeDocumentCover)
	engine.GET("/bases/:id/plaza", GetKnowledgePlazaItem)
	engine.POST("/bases/:id/subscribe", SubscribeKnowledgeBase)
	request := func(method, path, body string, user, role int) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Test-User", strconv.Itoa(user))
		r.Header.Set("Test-Role", strconv.Itoa(role))
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, r)
		return w
	}
	path := "/bases/" + strconv.Itoa(base.Id) + "/publication"
	own := request(http.MethodGet, path, "", 7, model.RoleCommonUser)
	require.Equal(t, http.StatusOK, own.Code, own.Body.String())
	require.NotContains(t, own.Body.String(), "categories")
	denied := request(http.MethodPost, path, `{"target":"subscription"}`, 8, model.RoleAdminUser)
	require.Equal(t, http.StatusForbidden, denied.Code)
	missingPrice := request(http.MethodPost, path, `{"target":"subscription"}`, 7, model.RoleCommonUser)
	require.Equal(t, http.StatusBadRequest, missingPrice.Code, missingPrice.Body.String())
	pricePath := "/bases/" + strconv.Itoa(base.Id) + "/credit-price"
	invalidPrice := request(http.MethodPut, pricePath, `{"browse_cents":0,"question_cents":1.1,"download_cents":20}`, 7, model.RoleCommonUser)
	require.Equal(t, http.StatusBadRequest, invalidPrice.Code, invalidPrice.Body.String())
	savedPrice := request(http.MethodPut, pricePath, `{"browse_cents":0,"question_cents":101,"download_cents":20}`, 7, model.RoleCommonUser)
	require.Equal(t, http.StatusOK, savedPrice.Code, savedPrice.Body.String())
	applied := request(http.MethodPost, path, `{"target":"subscription","reason":"共享资料"}`, 7, model.RoleCommonUser)
	require.Equal(t, http.StatusOK, applied.Code, applied.Body.String())
	pendingPrices := request(http.MethodGet, "/bases/credit-prices", "", 7, model.RoleCommonUser)
	require.Equal(t, http.StatusOK, pendingPrices.Code, pendingPrices.Body.String())
	require.Contains(t, pendingPrices.Body.String(), `"items":[]`)
	var envelope struct {
		Data model.KnowledgePublicationApplication `json:"data"`
	}
	require.NoError(t, json.Unmarshal(applied.Body.Bytes(), &envelope))
	for _, suffix := range []string{"/documents", "/documents/private-file/file", "/documents/private-file/chunks", "/documents/private-file/cover"} {
		denied := request(http.MethodGet, "/bases/"+strconv.Itoa(base.Id)+suffix, "", 8, model.RoleCommonUser)
		require.Equal(t, http.StatusForbidden, denied.Code, "pending access %s: %s", suffix, denied.Body.String())
	}
	plazaPending := request(http.MethodGet, "/bases/"+strconv.Itoa(base.Id)+"/plaza", "", 8, model.RoleCommonUser)
	require.Equal(t, http.StatusNotFound, plazaPending.Code, plazaPending.Body.String())
	subscribePending := request(http.MethodPost, "/bases/"+strconv.Itoa(base.Id)+"/subscribe", "", 8, model.RoleCommonUser)
	require.Equal(t, http.StatusBadRequest, subscribePending.Code, subscribePending.Body.String())
	duplicate := request(http.MethodPost, path, `{"target":"subscription"}`, 7, model.RoleCommonUser)
	require.Equal(t, http.StatusConflict, duplicate.Code)
	reviewPath := "/reviews/" + strconv.Itoa(envelope.Data.Id)
	unauthorized := request(http.MethodPost, reviewPath, `{"decision":"approve"}`, 7, model.RoleCommonUser)
	require.Equal(t, http.StatusForbidden, unauthorized.Code)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Set("role", model.RoleAdminUser)
	ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(envelope.Data.Id)}}
	require.True(t, publicationReviewLibrary(ctx))
	reviewBase, ok := managedKnowledgeBase(ctx)
	require.True(t, ok)
	require.Equal(t, base.Id, reviewBase.Id)
	approved := request(http.MethodPost, reviewPath, `{"decision":"approve"}`, 1, model.RoleAdminUser)
	require.Equal(t, http.StatusOK, approved.Code, approved.Body.String())
	stored, err := model.GetKnowledgeBase(base.Id)
	require.NoError(t, err)
	require.Zero(t, stored.CategoryId)
	require.Equal(t, "subscription", stored.PublicationScope)
	require.Equal(t, model.KnowledgeBasePersonal, stored.Kind)
	ownerPrices := request(http.MethodGet, "/bases/credit-prices", "", 7, model.RoleCommonUser)
	require.Equal(t, http.StatusOK, ownerPrices.Code, ownerPrices.Body.String())
	require.Contains(t, ownerPrices.Body.String(), `"name":"个人库"`)
	require.Contains(t, ownerPrices.Body.String(), `"question_cents":101`)
	require.NotContains(t, ownerPrices.Body.String(), categorized.Name)
	otherPrices := request(http.MethodGet, "/bases/credit-prices", "", 8, model.RoleCommonUser)
	require.Equal(t, http.StatusOK, otherPrices.Code, otherPrices.Body.String())
	require.Contains(t, otherPrices.Body.String(), `"items":[]`)
}

func TestKnowledgePublishedPersonalLibraryWriteIsOwnerOnly(t *testing.T) {
	for _, handler := range []func(*gin.Context, *model.KnowledgeBase){uploadKnowledgeDocument} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", 8)
		c.Set("role", model.RoleCommonUser)
		c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
		handler(c, &model.KnowledgeBase{Id: 1, OwnerUserId: 7, Kind: model.KnowledgeBasePersonal, PublicationScope: "public"})
		require.Equal(t, http.StatusForbidden, recorder.Code)
	}
}
