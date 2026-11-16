package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func TestUnifiedChargePointResources(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
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
	if err = db.AutoMigrate(&model.User{}, &model.UserTimedQuota{}, &model.BillingRule{}, &model.BillingTask{}, &model.Skill{}, &model.ExpertWebProfile{}, &model.KnowledgeBase{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []interface{}{
		&model.User{Id: 1, Username: "payer", Quota: 20000, TimedQuotaTotal: 20000},
		&model.UserTimedQuota{UserId: 1, Amount: 20000, Remaining: 20000, Source: "admin"},
		&model.Skill{Name: "contract", DisplayName: "合同起草", Status: 1, TaskCredits: 2},
		&model.ExpertWebProfile{Key: "geology", Name: "地质专家", Published: true},
		&model.KnowledgeBase{Id: 20, Name: "项目知识库", OwnerUserId: 1, RagflowDatasetId: "dataset", Kind: "personal"},
	} {
		if err = db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("id", 1)
		c.Set("role", model.RoleRootUser)
		c.Set("billing.context", model.BusinessBillingContext{UserID: 1, ExpertKey: "geology"})
	})
	r.POST("/resources/:kind/:item/points", AdminSaveChargePoint)
	r.GET("/resources/:kind/:item/points", AdminListChargePoints)
	r.PUT("/resources/:kind/:item/points/:point", AdminSaveChargePoint)
	// Set scope only for expert requests; platform skill/knowledge callers use normal login.
	r.Use(func(c *gin.Context) {
		if c.Query("kind") != "expert" {
			delete(c.Keys, "billing.context")
		}
	})
	r.GET("/quote", GetBillingQuote)
	r.POST("/tasks", func(c *gin.Context) {
		delete(c.Keys, "billing.context")
		var body map[string]interface{}
		raw, _ := c.GetRawData()
		json.Unmarshal(raw, &body)
		c.Request.Body = io.NopCloser(bytes.NewReader(raw))
		if body["kind"] == "expert" {
			c.Set("billing.context", model.BusinessBillingContext{UserID: 1, ExpertKey: "geology"})
		}
		ReserveBusinessBilling(c)
	})
	r.POST("/tasks/:id/result", ResultBusinessBilling)
	call := func(method, path, token string, body interface{}) (int, map[string]interface{}) {
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var out map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(w.Body.String())
		}
		return w.Code, out
	}
	for _, resource := range []struct{ kind, item string }{{"expert", "geology"}, {"skill", "contract"}, {"knowledge", "20"}} {
		kind, item := resource.kind, resource.item
		status, out := call("POST", "/resources/"+kind+"/"+item+"/points", "", map[string]interface{}{"name": "生成报告", "credits": "3", "enabled": true})
		if status != 200 {
			t.Fatal(status, out)
		}
		point := out["data"].(map[string]interface{})
		id := point["id"].(string)
		status, out = call("GET", "/quote?kind="+kind+"&item_id="+item+"&charge_point_id="+id, "", nil)
		if status != 200 {
			t.Fatal(status, out)
		}
		request := map[string]interface{}{"kind": kind, "item_id": item, "charge_point_id": id, "request_id": kind + "-paid", "quantity": 1, "version": 1}
		status, out = call("POST", "/tasks", "", request)
		if status != 200 {
			t.Fatal(status, out)
		}
		task := out["data"].(map[string]interface{})
		token := out["task_token"].(string)
		if task["point_name"] != "生成报告" || task["resource_name"] == "" || task["quota"] != float64(3000) {
			t.Fatal(task)
		}
		status, out = call("PUT", "/resources/"+kind+"/"+item+"/points/"+id, "", map[string]interface{}{"name": "已改名", "credits": "9", "enabled": false, "version": 1})
		if status != 200 {
			t.Fatal(status, out)
		}
		for i := 0; i < 2; i++ {
			status, out = call("POST", fmt.Sprint("/tasks/", task["id"], "/result"), token, map[string]string{"status": "succeeded"})
			if status != 200 {
				t.Fatal(status, out)
			}
		}
		var saved model.BillingTask
		db.First(&saved, "id = ?", task["id"])
		if saved.PointName != "生成报告" || saved.Quota != 3000 {
			t.Fatal("lost price/name snapshot", saved)
		}
		if label := businessCreditLabel(saved); bytes.Contains([]byte(label), []byte(id)) || !bytes.Contains([]byte(label), []byte("生成报告")) {
			t.Fatal(label)
		}
		request["request_id"], request["version"] = kind+"-free", 2
		status, out = call("POST", "/tasks", "", request)
		if status != 200 || out["data"].(map[string]interface{})["quota"] != float64(0) {
			t.Fatal("disabled must be free", status, out)
		}
		request["charge_point_id"] = "cp_missing"
		request["request_id"] = kind + "-missing"
		status, out = call("POST", "/tasks", "", request)
		if status != 404 {
			t.Fatal("missing point accepted", status, out)
		}
	}
	// Skill default IDs are stable and retain their migrated price independently of other points.
	a, err := model.EnsureSkillChargePoint(db, "contract")
	if err != nil {
		t.Fatal(err)
	}
	b, err := model.EnsureSkillChargePoint(db, "contract")
	if err != nil || a.ID != b.ID || a.UnitQuota != 2000 {
		t.Fatal(a, b, err)
	}
	if a.Kind != "skill" || a.Action != "default" {
		t.Fatal(a)
	}
	var user model.User
	db.First(&user, 1)
	if user.Quota != 11000 || user.UsedQuota != 9000 {
		t.Fatal(user.Quota, user.UsedQuota)
	}
	config.OptionMapRWMutex.Lock()
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"operational","billing":{"enabled":false}}`
	config.OptionMapRWMutex.Unlock()
	status, out := call("POST", "/tasks", "", map[string]interface{}{"kind": "knowledge", "item_id": "20", "charge_point_id": "cp_missing"})
	if status != 200 || out["data"].(map[string]interface{})["exempt"] != true {
		t.Fatal("disabled system blocked business", status, out)
	}
}
