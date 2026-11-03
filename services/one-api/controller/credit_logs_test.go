package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"net/http/httptest"
	"testing"
)

func TestCreditLogsFilterAndPagination(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	old := model.LOG_DB
	model.LOG_DB = db
	defer func() { model.LOG_DB = old }()
	if err = db.AutoMigrate(&model.Log{}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 52; i++ {
		db.Create(&model.Log{Type: model.LogTypeConsume, Username: "alice", ModelName: "test", Quota: 354, CreditBilling: `{"quota_per_unit":1000}`})
	}
	db.Create(&model.Log{Type: model.LogTypeError, Username: "alice"})
	for _, test := range []struct {
		url          string
		count, total int
	}{{"/?keyword=alice&p=0", 50, 52}, {"/?keyword=alice&p=1", 2, 52}, {"/?keyword=other", 0, 0}} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", test.url, nil)
		GetCreditLogs(c)
		var result struct {
			Success bool `json:"success"`
			Data    struct {
				Items []model.Log `json:"items"`
				Total int         `json:"total"`
			} `json:"data"`
		}
		if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if !result.Success || len(result.Data.Items) != test.count || result.Data.Total != test.total {
			t.Fatalf("unexpected response %s", w.Body.String())
		}
	}
}
