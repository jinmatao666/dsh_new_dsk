package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func expertWebTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "experts.sqlite")+"?_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sql, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sql.SetMaxOpenConns(4)
	if err := db.Exec("PRAGMA journal_mode=WAL").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ExpertWebProfile{}, &model.ExpertWebTicket{}, &model.ExpertCategory{}); err != nil {
		t.Fatal(err)
	}
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous; _ = sql.Close() })
	if err := db.Create(&model.ExpertCategory{Name: "办公工具", Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.GET("/catalog", ListExpertWebCatalog)
	router.POST("/create", AdminCreateExpertWebsite)
	router.PUT("/:key/publish", AdminPublishExpertWebsite)
	router.POST("/:key/rotate", AdminRotateExpertWebCredential)
	router.POST("/:key/launch", func(c *gin.Context) { c.Set("id", 123); LaunchExpertWebsite(c) })
	router.POST("/:key/anonymous-launch", LaunchExpertWebsite)
	router.POST("/redeem", RedeemExpertWebTicket)
	return router
}

func expertWebRequest(router http.Handler, method, path, body, authorization string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func expertWebCreatePublished(t *testing.T, router http.Handler) string {
	t.Helper()
	response := expertWebRequest(router, "POST", "/create", `{"key":"brand-new-expert","name":"独立专家","category":"办公工具","provider":"提供方","workbench_url":"https://expert.test/","tags":"[]"}`, "")
	if response.Code != 201 {
		t.Fatalf("create: %d %s", response.Code, response.Body.String())
	}
	var result struct {
		Credential string `json:"provider_credential"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if expertWebRequest(router, "PUT", "/brand-new-expert/publish", `{"published":true}`, "").Code != 200 {
		t.Fatal("publish failed")
	}
	return result.Credential
}

func expertWebLaunch(t *testing.T, router http.Handler) string {
	t.Helper()
	response := expertWebRequest(router, "POST", "/brand-new-expert/launch", "{}", "")
	if response.Code != 200 {
		t.Fatalf("launch: %d %s", response.Code, response.Body.String())
	}
	var result struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Ticket
}

func TestExpertWebDatabaseExchangeAndCatalogDoNotExposeCredentials(t *testing.T) {
	router := expertWebTestRouter(t)
	credential := expertWebCreatePublished(t, router)
	if expertWebRequest(router, "POST", "/brand-new-expert/anonymous-launch", "{}", "").Code != 401 {
		t.Fatal("anonymous launch accepted")
	}
	ticket := expertWebLaunch(t, router)
	catalog := expertWebRequest(router, "GET", "/catalog", "", "")
	if catalog.Code != 200 || !bytes.Contains(catalog.Body.Bytes(), []byte("brand-new-expert")) {
		t.Fatal("dynamic expert absent")
	}
	if strings.Contains(catalog.Body.String(), credential) || strings.Contains(catalog.Body.String(), "provider_secret_hash") {
		t.Fatal("credential exposed")
	}
	payload := fmt.Sprintf(`{"ticket":%q}`, ticket)
	for _, header := range []string{credential, "Basic " + credential, "Bearer " + strings.Repeat("b", 64)} {
		if expertWebRequest(router, "POST", "/redeem", payload, header).Code != 401 {
			t.Fatal("bad authorization accepted")
		}
	}
	success := expertWebRequest(router, "POST", "/redeem", payload, "Bearer "+credential)
	if success.Code != 200 || success.Body.String() != `{"user_id":"123"}` {
		t.Fatalf("exchange failed: %s", success.Body.String())
	}
	if expertWebRequest(router, "POST", "/redeem", payload, "Bearer "+credential).Code != 401 {
		t.Fatal("replay accepted")
	}
}

func TestExpertWebDatabaseExpirationUnpublishAndRotation(t *testing.T) {
	router := expertWebTestRouter(t)
	credential := expertWebCreatePublished(t, router)
	expired := expertWebLaunch(t, router)
	if err := model.DB.Model(&model.ExpertWebTicket{}).Where("hash = ?", expertWebDigest(expired)).Update("expires_at", time.Now().Unix()-1).Error; err != nil {
		t.Fatal(err)
	}
	if expertWebRequest(router, "POST", "/redeem", fmt.Sprintf(`{"ticket":%q}`, expired), "Bearer "+credential).Code != 401 {
		t.Fatal("expired accepted")
	}
	active := expertWebLaunch(t, router)
	var count int64
	model.DB.Model(&model.ExpertWebTicket{}).Where("hash = ?", expertWebDigest(expired)).Count(&count)
	if count != 0 {
		t.Fatal("expired record retained after launch")
	}
	expertWebRequest(router, "PUT", "/brand-new-expert/publish", `{"published":false}`, "")
	if expertWebRequest(router, "POST", "/redeem", fmt.Sprintf(`{"ticket":%q}`, active), "Bearer "+credential).Code != 401 {
		t.Fatal("unpublished accepted")
	}
	if expertWebRequest(router, "POST", "/brand-new-expert/launch", "{}", "").Code != 404 {
		t.Fatal("unpublished launch accepted")
	}
	expertWebRequest(router, "PUT", "/brand-new-expert/publish", `{"published":true}`, "")
	rotated := expertWebRequest(router, "POST", "/brand-new-expert/rotate", "{}", "")
	var result struct {
		Credential string `json:"provider_credential"`
	}
	if err := json.Unmarshal(rotated.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	payload := fmt.Sprintf(`{"ticket":%q}`, active)
	if expertWebRequest(router, "POST", "/redeem", payload, "Bearer "+credential).Code != 401 {
		t.Fatal("old credential accepted")
	}
	if expertWebRequest(router, "POST", "/redeem", payload, "Bearer "+result.Credential).Code != 200 {
		t.Fatal("new credential rejected")
	}
}

func TestExpertWebDatabaseConcurrentRedemptionSucceedsOnce(t *testing.T) {
	router := expertWebTestRouter(t)
	credential := expertWebCreatePublished(t, router)
	ticket := expertWebLaunch(t, router)
	payload := fmt.Sprintf(`{"ticket":%q}`, ticket)
	var successes atomic.Int32
	var failures atomic.Int32
	var group sync.WaitGroup
	for index := 0; index < 16; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			response := expertWebRequest(router, "POST", "/redeem", payload, "Bearer "+credential)
			if response.Code == 200 {
				successes.Add(1)
			} else if response.Code == 401 {
				failures.Add(1)
			}
		}()
	}
	group.Wait()
	if successes.Load() != 1 || failures.Load() != 15 {
		t.Fatalf("unexpected results: success=%d rejected=%d", successes.Load(), failures.Load())
	}
}
