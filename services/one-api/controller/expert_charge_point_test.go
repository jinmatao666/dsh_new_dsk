package controller

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func TestExpertChargePointLifecycle(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldSQLite, oldRedis, oldUnit := model.DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit
	model.DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit = db, true, false, 1000
	config.OptionMapRWMutex.Lock()
	oldMap := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"edition":"operational","creditsEnabled":true}`}
	config.OptionMapRWMutex.Unlock()
	defer func() {
		model.DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit = oldDB, oldSQLite, oldRedis, oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldMap
		config.OptionMapRWMutex.Unlock()
	}()
	if err = db.AutoMigrate(&model.User{}, &model.UserTimedQuota{}, &model.ExpertWebProfile{}, &model.BusinessBillingContext{}, &model.BillingRule{}, &model.BillingTask{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&model.User{Id: 1, Username: "payer", Status: model.UserStatusEnabled, Quota: 10000, TimedQuotaTotal: 10000})
	db.Create(&model.UserTimedQuota{UserId: 1, Amount: 10000, Remaining: 10000, Source: model.TimedQuotaSourceAdmin})
	db.Create(&model.ExpertWebProfile{Key: "expert-a", Published: true, ProviderSecretHash: "provider"})
	db.Create(&model.ExpertWebProfile{Key: "expert-b", Published: true, ProviderSecretHash: "other"})
	db.Create(&model.BusinessBillingContext{Hash: model.BillingDigest("wbc_test"), UserID: 1, ExpertKey: "expert-a", ProviderHash: "provider", ExpiresAt: time.Now().Add(time.Hour)})
	r := gin.New()
	r.GET("/admin/:key/points", AdminListChargePoints)
	r.POST("/admin/:key/points", AdminSaveChargePoint)
	r.PUT("/admin/:key/points/:point", AdminSaveChargePoint)
	denyUser := func(c *gin.Context) { c.AbortWithStatus(401) }
	r.GET("/quote", BusinessBillingAuth(denyUser), GetBillingQuote)
	r.POST("/tasks", BusinessBillingAuth(denyUser), ReserveBusinessBilling)
	r.POST("/tasks/:id/result", ResultBusinessBilling)
	call := func(method, path, token string, data interface{}) (int, map[string]interface{}) {
		b, _ := json.Marshal(data)
		req := httptest.NewRequest(method, path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var response map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &response)
		return w.Code, response
	}
	pointInput := map[string]interface{}{"name": "分析", "description": "分析范围", "credits": "2.5", "enabled": true}
	status, response := call("POST", "/admin/expert-a/points", "", pointInput)
	if status != 200 {
		t.Fatal(status, response)
	}
	point := response["data"].(map[string]interface{})
	id := point["id"].(string)
	if !regexp.MustCompile(`^cp_[0-9a-f]{12}$`).MatchString(id) {
		t.Fatal("unexpected compact ID", id)
	}
	if point["credits"] != 2.5 || point["version"] != float64(1) {
		t.Fatal(point)
	}
	status, response = call("GET", "/quote?charge_point_id="+id, "wbc_test", nil)
	if status != 200 || response["data"].(map[string]interface{})["unit_credits"] != 2.5 {
		t.Fatal(status, response)
	}
	status, _ = call("POST", "/tasks", "wbc_test", map[string]interface{}{"mode": "developer", "action": "anything", "points": "0", "request_id": "bypass"})
	if status != 400 {
		t.Fatal("developer bypass", status)
	}
	request := map[string]interface{}{"charge_point_id": id, "kind": "expert", "item_id": "expert-a", "mode": "configured", "quantity": 1, "version": 1, "request_id": "task-1"}
	status, response = call("POST", "/tasks", "wbc_test", request)
	if status != 200 {
		t.Fatal(status, response)
	}
	task := response["data"].(map[string]interface{})
	taskID, taskToken := task["id"].(string), response["task_token"].(string)
	if task["quota"] != float64(2500) {
		t.Fatal(task)
	}
	status, response = call("POST", "/tasks", "wbc_test", request)
	if status != 200 || response["task_token"] != "" {
		t.Fatal("retry", status, response)
	}
	pointInput["version"], pointInput["credits"] = 1, "4"
	status, _ = call("PUT", "/admin/expert-a/points/"+id, "", pointInput)
	if status != 200 {
		t.Fatal(status)
	}
	status, _ = call("PUT", "/admin/expert-a/points/"+id, "", pointInput)
	if status != 409 {
		t.Fatal("stale edit", status)
	}
	request["request_id"] = "task-stale"
	status, _ = call("POST", "/tasks", "wbc_test", request)
	if status != 409 {
		t.Fatal("stale quote", status)
	}
	pointInput["version"], pointInput["enabled"] = 2, false
	status, _ = call("PUT", "/admin/expert-a/points/"+id, "", pointInput)
	if status != 200 {
		t.Fatal(status)
	}
	request["version"] = 3
	status, _ = call("POST", "/tasks", "wbc_test", request)
	if status != 200 {
		t.Fatal("disabled point must allow free execution", status)
	}
	status, response = call("POST", "/tasks/"+taskID+"/result", taskToken, map[string]string{"status": "succeeded"})
	if status != 200 || response["data"].(map[string]interface{})["quota"] != float64(2500) {
		t.Fatal("existing reservation", status, response)
	}
	status, _ = call("POST", "/tasks/"+taskID+"/result", taskToken, map[string]string{"status": "succeeded"})
	if status != 200 {
		t.Fatal(status)
	}
	if _, err := resolveChargePoint("expert", "expert-b", id); err == nil {
		t.Fatal("cross-expert point accepted")
	}
	status, _ = call("PUT", "/admin/expert-b/points/"+id, "", pointInput)
	if status != 409 {
		t.Fatal("cross-expert edit", status)
	}
	status, _ = call("GET", "/quote?charge_point_id="+id, "", nil)
	if status != 401 {
		t.Fatal("unauthenticated quote", status)
	}
	var user model.User
	db.First(&user, 1)
	if user.Quota != 7500 || user.UsedQuota != 2500 {
		t.Fatal("unexpected balance", user.Quota, user.UsedQuota)
	}
}
