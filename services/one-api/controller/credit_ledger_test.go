package controller

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func TestCreditLedgerSearchAndBeijingDateBoundary(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	if err = db.AutoMigrate(&model.User{}, &model.CreditLedger{}, &model.CreditLedgerMigration{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&model.User{Id: 7, Username: "alice", Phone: "13800138000", DisplayName: "张三", DepartmentName: "规划处"})
	start := time.Date(2026, 11, 19, 16, 0, 0, 0, time.UTC).Unix()
	for i, when := range []int64{start - 1, start, start + 86399, start + 86400} {
		if err = db.Omit("origin").Create(&model.CreditLedger{UserID: 7, OccurredAt: when, Delta: int64(i+1) * 1000, ActorID: 9, ActorName: "root", Source: "admin"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.GET("/credits", GetCreditLedger)
	request := func(query string) (int, map[string]interface{}) {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest("GET", "/credits?from=2026-11-20&to=2026-11-20"+query, nil))
		var body map[string]interface{}
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return recorder.Code, body
	}
	code, body := request("&keyword=13800138000&user_id=7&actor_id=9&direction=in&source=admin")
	if code != 200 {
		t.Fatal(code, body)
	}
	data := body["data"].(map[string]interface{})
	if data["total"] != float64(2) || data["incoming"] != float64(5000) || data["outgoing"] != float64(0) {
		t.Fatalf("incorrect boundaries or sum: %+v", data)
	}
	_, body = request("&user_id=8")
	if body["data"].(map[string]interface{})["total"] != float64(0) {
		t.Fatal("user filter leaked records")
	}
	_, body = request("&keyword=root")
	if body["data"].(map[string]interface{})["total"] != float64(2) {
		t.Fatal("operator search failed")
	}
	for _, query := range []string{"&user_id=bad", "&actor_id=-1", "&direction=invalid"} {
		if code, _ := request(query); code != 400 {
			t.Fatal("invalid filter accepted", query)
		}
	}
}

func TestCreditLedgerSettledNet(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldLog := model.DB, model.LOG_DB
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLog })
	if err = db.AutoMigrate(&model.CreditLedger{}, &model.CreditLedgerMigration{}, &model.BillingTask{}, &model.Log{}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 20, 8, 0, 0, 0, time.UTC).Unix()
	for _, row := range []model.CreditLedger{
		{UserID: 7, OccurredAt: now, Source: "model_reserve", Reference: "done", Delta: -308686},
		{UserID: 7, OccurredAt: now + 1, Source: "model_refund", Reference: "done", Delta: 163610},
		{UserID: 7, OccurredAt: now, Source: "model_reserve", Reference: "pending", Delta: -2000},
		{UserID: 7, OccurredAt: now, Source: "model_reserve", Reference: "failed", Delta: -2000},
		{UserID: 7, OccurredAt: now + 1, Source: "model_refund", Reference: "failed", Delta: 2000},
	} {
		if err = db.Omit("origin").Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.GET("/credits", GetCreditLedger)
	out := httptest.NewRecorder()
	router.ServeHTTP(out, httptest.NewRequest("GET", "/credits?from=2026-11-20&to=2026-11-20&view=settled&source=model_consume&direction=out", nil))
	var body struct {
		Data struct {
			Total, Incoming, Outgoing int64
			Items                     []model.CreditLedger
		}
	}
	if err := json.Unmarshal(out.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	d := body.Data
	if out.Code != 200 || d.Total != 1 || d.Incoming != 0 || d.Outgoing != 145076 || len(d.Items) != 1 || len(d.Items[0].Entries) != 2 {
		t.Fatal(out.Code, out.Body.String())
	}
}
