package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"net/http/httptest"
	"testing"
)

func TestDesktopCreditsUserIsolation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	oldDB, oldLogs, unit := model.DB, model.LOG_DB, config.QuotaPerUnit
	model.DB = db
	model.LOG_DB = db
	config.QuotaPerUnit = 1000
	defer func() { model.DB = oldDB; model.LOG_DB = oldLogs; config.QuotaPerUnit = unit }()
	if err = db.AutoMigrate(&model.User{}, &model.UserTimedQuota{}, &model.DesktopCheckinReceipt{}, &model.AdminCreditGrant{}, &model.Log{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&model.User{Id: 901, Username: "own", Quota: 5000})
	db.Create(&model.User{Id: 902, Username: "other", Quota: 99000})
	db.Create(&model.UserTimedQuota{UserId: 901, Amount: 1000, Source: "checkin", SourceRef: "2026-11-04"})
	db.Create(&model.UserTimedQuota{UserId: 902, Amount: 99000, Source: "register"})
	db.Create(&model.DesktopCheckinReceipt{UserId: 901, Day: "2026-11-04", Amount: 1000, BalanceAfter: 5000})
	db.Create(&model.Log{UserId: 901, Type: model.LogTypeConsume, ModelName: "own-model", Quota: 125, CreatedAt: 100})
	db.Create(&model.Log{UserId: 902, Type: model.LogTypeConsume, ModelName: "secret-model", Quota: 99999, CreatedAt: 200})
	for _, filter := range []string{"all", "earned", "spent"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/api/user/self/credits?filter="+filter, nil)
		c.Set(ctxkey.Id, 901)
		GetDesktopCredits(c)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var result struct {
			Data struct {
				Balance float64
				Total   int
				Items   []desktopCreditItem
			}
		}
		if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		expected := 1
		if filter == "all" {
			expected = 2
		}
		if result.Data.Total != expected || len(result.Data.Items) != expected || result.Data.Balance != 5 {
			t.Fatal(w.Body.String())
		}
		for _, row := range result.Data.Items {
			if row.Name == "模型调用 · secret-model" {
				t.Fatal("cross-user disclosure")
			}
			if row.Credits > 0 && (row.Balance == nil || *row.Balance != 5) {
				t.Fatal("missing claim balance")
			}
		}
	}
}
