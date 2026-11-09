package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func setupPortalLandMarketTest(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&model.PortalFeatureTicket{}, &model.Option{}, &model.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Create(&model.User{
		Id:          42,
		Username:    "land_user",
		DisplayName: "土地测试用户",
		Role:        model.RoleCommonUser,
		Status:      model.UserStatusEnabled,
		AffCode:     "land42",
	}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	config.OptionMapRWMutex.Lock()
	previousOptions := config.OptionMap
	config.OptionMap = map[string]string{
		"SystemDeploymentSettings":           `{"network":"internet","featurePages":{"landMarket":{"url":"https://land.example/#/home"},"policyEncyclopedia":{"url":""}}}`,
		model.LandMarketProviderSecretOption: "",
	}
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		config.OptionMapRWMutex.Lock()
		config.OptionMap = previousOptions
		config.OptionMapRWMutex.Unlock()
	})

	router := gin.New()
	router.POST("/launch", func(c *gin.Context) {
		c.Set("id", 42)
		LaunchLandMarket(c)
	})
	router.POST("/redeem", RedeemLandMarketTicket)
	router.POST("/credential", RotateLandMarketCredential)
	router.GET("/credential", GetLandMarketCredentialStatus)
	return router
}

func portalJSON(t *testing.T, router *gin.Engine, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func TestLandMarketCredentialRotateLaunchRedeem(t *testing.T) {
	router := setupPortalLandMarketTest(t)

	status := portalJSON(t, router, http.MethodGet, "/credential", "", nil)
	if status.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", status.Code, status.Body.String())
	}
	var statusBody map[string]interface{}
	if err := json.Unmarshal(status.Body.Bytes(), &statusBody); err != nil {
		t.Fatal(err)
	}
	if statusBody["configured"] != false {
		t.Fatalf("expected unconfigured, got %#v", statusBody)
	}

	if code := portalJSON(t, router, http.MethodPost, "/launch", "{}", nil).Code; code != http.StatusServiceUnavailable {
		t.Fatalf("launch without credential: code=%d", code)
	}

	rotate := portalJSON(t, router, http.MethodPost, "/credential", "", nil)
	if rotate.Code != http.StatusOK {
		t.Fatalf("rotate code=%d body=%s", rotate.Code, rotate.Body.String())
	}
	var rotateBody map[string]interface{}
	if err := json.Unmarshal(rotate.Body.Bytes(), &rotateBody); err != nil {
		t.Fatal(err)
	}
	credential, _ := rotateBody["provider_credential"].(string)
	if !expertCredentialPattern.MatchString(credential) {
		t.Fatalf("bad credential %q", credential)
	}

	launch := portalJSON(t, router, http.MethodPost, "/launch", "{}", nil)
	if launch.Code != http.StatusOK {
		t.Fatalf("launch code=%d body=%s", launch.Code, launch.Body.String())
	}
	var launchBody map[string]interface{}
	if err := json.Unmarshal(launch.Body.Bytes(), &launchBody); err != nil {
		t.Fatal(err)
	}
	ticket, _ := launchBody["ticket"].(string)
	if launchBody["url"] != "https://land.example/#/home" || !expertCredentialPattern.MatchString(ticket) {
		t.Fatalf("bad launch %#v", launchBody)
	}

	bad := portalJSON(t, router, http.MethodPost, "/redeem", `{"ticket":"`+ticket+`"}`, map[string]string{
		"Authorization": "Bearer " + credential[:60] + "aaaa",
	})
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("bad credential redeem code=%d", bad.Code)
	}

	ok := portalJSON(t, router, http.MethodPost, "/redeem", `{"ticket":"`+ticket+`"}`, map[string]string{
		"Authorization": "Bearer " + credential,
	})
	if ok.Code != http.StatusOK {
		t.Fatalf("redeem code=%d body=%s", ok.Code, ok.Body.String())
	}
	var redeemBody map[string]interface{}
	if err := json.Unmarshal(ok.Body.Bytes(), &redeemBody); err != nil {
		t.Fatal(err)
	}
	if redeemBody["user_id"] != "42" {
		t.Fatalf("user_id=%v", redeemBody["user_id"])
	}
	if redeemBody["username"] != "land_user" || redeemBody["display_name"] != "土地测试用户" {
		t.Fatalf("identity=%#v", redeemBody)
	}

	replay := portalJSON(t, router, http.MethodPost, "/redeem", `{"ticket":"`+ticket+`"}`, map[string]string{
		"Authorization": "Bearer " + credential,
	})
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("replay code=%d", replay.Code)
	}
}
