package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func TestChargePointBillingIdentityAndCost(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldSQLite, oldRedis, oldUnit := model.DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit
	model.DB = db
	common.UsingSQLite = true
	common.RedisEnabled = false
	config.QuotaPerUnit = 1000
	config.OptionMapRWMutex.Lock()
	oldMap := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"edition":"operational","creditsEnabled":true}`}
	config.OptionMapRWMutex.Unlock()
	defer func() {
		model.DB = oldDB
		common.UsingSQLite = oldSQLite
		common.RedisEnabled = oldRedis
		config.QuotaPerUnit = oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldMap
		config.OptionMapRWMutex.Unlock()
	}()
	if err := db.AutoMigrate(&model.User{}, &model.UserTimedQuota{}, &model.ExpertWebProfile{}, &model.ExpertWebTicket{}, &model.BusinessBillingContext{}, &model.BillingRule{}, &model.BillingTask{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&model.User{Id: 1, Username: "payer", Status: model.UserStatusEnabled, Quota: 10000, TimedQuotaTotal: 10000})
	db.Create(&model.UserTimedQuota{UserId: 1, Amount: 10000, Remaining: 10000, Source: model.TimedQuotaSourceAdmin})
	provider, _ := expertWebRandom()
	ticket, _ := expertWebRandom()
	db.Create(&model.ExpertWebProfile{Key: "report-expert", Name: "Report", Published: true, ProviderSecretHash: expertWebDigest(provider)})
	db.Create(&model.ExpertWebTicket{Hash: expertWebDigest(ticket), ExpertKey: "report-expert", UserID: 1, ExpiresAt: time.Now().Add(time.Minute).Unix()})
	router := gin.New()
	router.POST("/redeem", RedeemExpertWebTicket)
	userAuth := func(c *gin.Context) {
		if c.GetHeader("Authorization") != "Bearer user" {
			c.AbortWithStatus(401)
			return
		}
		c.Set("id", 1)
		c.Next()
	}
	router.GET("/quote", BusinessBillingAuth(userAuth), GetBillingQuote)
	router.POST("/tasks", BusinessBillingAuth(userAuth), ReserveBusinessBilling)
	router.POST("/tasks/:id/result", ResultBusinessBilling)
	router.GET("/tasks/:id", BusinessBillingAuth(userAuth), GetBusinessBilling)
	call := func(method, path, token string, body interface{}) (int, map[string]interface{}) {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var result map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		return w.Code, result
	}
	status, identity := call("POST", "/redeem", provider, map[string]string{"ticket": ticket})
	if status != 200 {
		t.Fatalf("redeem failed %d", status)
	}
	context, ok := identity["billing_context"].(string)
	if !ok {
		t.Fatal("no billing context")
	}
	db.Create(&model.BillingRule{ID: "cp_qa", Kind: "expert", ItemID: "report-expert", Action: "cp_qa", Name: "问答", UnitQuota: 2500, Enabled: true, Version: 1})
	payload := map[string]interface{}{"mode": "configured", "kind": "expert", "item_id": "report-expert", "charge_point_id": "cp_qa", "quantity": 1, "version": 1, "description": "问答", "request_id": "question-1"}
	status, result := call("POST", "/tasks", context, payload)
	if status != 200 {
		t.Fatalf("developer reserve %d %#v", status, result)
	}
	data := result["data"].(map[string]interface{})
	id := data["id"].(string)
	token := result["task_token"].(string)
	if data["quota"].(float64) != 2500 || data["kind"] != "expert" || data["item_id"] != "report-expert" {
		t.Fatal("scope/amount not derived", data)
	}
	status, _ = call("POST", "/tasks/"+id+"/result", token, map[string]string{"status": "succeeded"})
	if status != 200 {
		t.Fatal(status)
	}
	status, _ = call("POST", "/tasks/"+id+"/result", token, map[string]string{"status": "succeeded"})
	if status != 200 {
		t.Fatal(status)
	}
	var user model.User
	db.First(&user, 1)
	if user.Quota != 7500 || user.UsedQuota != 2500 {
		t.Fatal("incorrect settlement", user.Quota, user.UsedQuota)
	}
	payload["quantity"] = 2
	status, _ = call("POST", "/tasks", context, payload)
	if status != 409 {
		t.Fatal("changed replay accepted", status)
	}
	payload["request_id"] = "question-2"
	payload["item_id"] = "other"
	status, _ = call("POST", "/tasks", context, payload)
	if status != 403 {
		t.Fatal("cross-expert accepted", status)
	}
	delete(payload, "item_id")
	payload["kind"] = "expert"
	payload["item_id"] = "report-expert"
	status, _ = call("POST", "/tasks", "user", payload)
	if status != 403 {
		t.Fatal("unscoped developer cost accepted", status)
	}
	payload["points"] = "1000.01"
	status, _ = call("POST", "/tasks", context, payload)
	if status != 400 {
		t.Fatal("oversized fee accepted", status)
	}
	payload["points"] = "0.0001"
	status, _ = call("POST", "/tasks", context, payload)
	if status != 400 {
		t.Fatal("fractional internal quota accepted", status)
	}

	db.Create(&model.BillingRule{ID: "cp_report", Kind: "expert", ItemID: "report-expert", Action: "cp_report", Name: "报告", UnitQuota: 2000, Enabled: true, Version: 1})
	status, quoted := call("GET", "/quote?kind=expert&item_id=report-expert&charge_point_id=cp_report", context, nil)
	if status != 200 {
		t.Fatalf("default quote %d %#v", status, quoted)
	}
	version := quoted["data"].(map[string]interface{})["rule"].(map[string]interface{})["version"]
	status, configured := call("POST", "/tasks", context, map[string]interface{}{"mode": "configured", "kind": "expert", "item_id": "report-expert", "charge_point_id": "cp_report", "quantity": 1, "version": version, "request_id": "default-1"})
	if status != 200 {
		t.Fatalf("default reserve %d %#v", status, configured)
	}
	configuredData := configured["data"].(map[string]interface{})
	if configuredData["quota"].(float64) != 2000 || configuredData["pricing_mode"] != "configured" {
		t.Fatal("default pricing changed", configuredData)
	}
	configuredID := configuredData["id"].(string)
	configuredToken := configured["task_token"].(string)
	status, _ = call("POST", "/tasks/"+configuredID+"/result", configuredToken, map[string]string{"status": "failed"})
	if status != 200 {
		t.Fatal("default refund failed", status)
	}
	db.First(&user, 1)
	if user.Quota != 7500 {
		t.Fatal("default failed task not refunded", user.Quota)
	}
	db.Model(&model.ExpertWebProfile{}).Where("key = ?", "report-expert").Update("provider_secret_hash", "rotated")
	status, _ = call("GET", "/tasks/"+id, context, nil)
	if status != 403 {
		t.Fatal("rotated expert scope still valid", status)
	}
	db.Model(&model.ExpertWebProfile{}).Where("key = ?", "report-expert").Update("provider_secret_hash", expertWebDigest(provider))
	db.Model(&model.BusinessBillingContext{}).Where("hash = ?", model.BillingDigest(context)).Update("expires_at", time.Now().Add(-time.Minute))
	status, _ = call("GET", "/tasks/"+id, context, nil)
	if status != http.StatusUnauthorized {
		t.Fatal("expired scope accepted", status)
	}
}
