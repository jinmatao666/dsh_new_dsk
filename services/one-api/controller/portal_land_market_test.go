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
	"github.com/stretchr/testify/require"
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
		"SystemDeploymentSettings":           `{"network":"internet","featurePages":{"landMarket":{"url":"https://land.example/#/home"},"planningLecture":{"url":"https://lecture.example/#/home"}}}`,
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
	router.POST("/planning-lecture/launch", func(c *gin.Context) {
		c.Set("id", 42)
		LaunchPlanningLecture(c)
	})
	router.POST("/planning-lecture/redeem", RedeemPlanningLectureTicket)
	router.POST("/planning-lecture/credential", RotatePlanningLectureCredential)
	router.GET("/planning-lecture/credential", GetPlanningLectureCredentialStatus)
	return router
}

func TestPlanningLectureCredentialAndTicketIsolation(t *testing.T) {
	router := setupPortalLandMarketTest(t)
	rotate := func(path string) string {
		response := portalJSON(t, router, http.MethodPost, path, "", nil)
		require.Equal(t, http.StatusOK, response.Code)
		var body struct {
			Credential string `json:"provider_credential"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Regexp(t, expertCredentialPattern, body.Credential)
		return body.Credential
	}
	landCredential := rotate("/credential")
	launchPath := "/planning-lecture/launch"
	require.Equal(t, http.StatusServiceUnavailable, portalJSON(t, router, http.MethodPost, launchPath, "", nil).Code)
	lectureCredential := rotate("/planning-lecture/credential")
	status := portalJSON(t, router, http.MethodGet, "/planning-lecture/credential", "", nil)
	require.JSONEq(t, `{"success":true,"configured":true}`, status.Body.String())
	launch := portalJSON(t, router, http.MethodPost, launchPath, "", nil)
	require.Equal(t, http.StatusOK, launch.Code)
	var body struct {
		URL    string `json:"url"`
		Ticket string `json:"ticket"`
	}
	require.NoError(t, json.Unmarshal(launch.Body.Bytes(), &body))
	require.Equal(t, "https://lecture.example/#/home", body.URL)
	require.Regexp(t, expertCredentialPattern, body.Ticket)
	redeem := func(path, credential string) *httptest.ResponseRecorder {
		return portalJSON(t, router, http.MethodPost, path, `{"ticket":"`+body.Ticket+`"}`,
			map[string]string{"Authorization": "Bearer " + credential})
	}
	require.Equal(t, http.StatusUnauthorized, redeem("/planning-lecture/redeem", landCredential).Code)
	require.Equal(t, http.StatusUnauthorized, redeem("/redeem", landCredential).Code)
	response := redeem("/planning-lecture/redeem", lectureCredential)
	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{"user_id":"42","username":"land_user","display_name":"土地测试用户"}`, response.Body.String())
	require.Equal(t, http.StatusUnauthorized, redeem("/planning-lecture/redeem", lectureCredential).Code)
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
