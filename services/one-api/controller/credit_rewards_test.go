package controller

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/middleware"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func TestCreditRewardsValidation(t *testing.T) {
	valid := `{"registration":{"enabled":true,"amount":2000},"login":{"enabled":false,"amount":100,"intervalDays":7}}`
	for _, raw := range []string{`{}`, `{"creditRewards":` + valid + `}`} {
		if err := validateCreditRewards(raw); err != nil {
			t.Fatal(err)
		}
	}
	for _, rules := range []string{`null`, `{}`, `[]`, `{"registration":null}`, `"invalid"`} {
		if validateCreditRewards(`{"creditRewards":`+rules+`}`) == nil {
			t.Fatalf("accepted %s", rules)
		}
	}
	for _, field := range []string{"amount", "intervalDays", "enabled"} {
		for _, invalid := range []interface{}{nil, "1", -1, 0, 1.5, 1000001} {
			var rules map[string]interface{}
			_ = json.Unmarshal([]byte(valid), &rules)
			rules["login"].(map[string]interface{})[field] = invalid
			raw, _ := json.Marshal(map[string]interface{}{"creditRewards": rules})
			if validateCreditRewards(string(raw)) == nil {
				t.Fatalf("accepted %s", raw)
			}
		}
	}
}

func TestCreditRewardsSaveAndAudit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	oldDB := model.DB
	model.DB = db
	config.OptionMapRWMutex.Lock()
	oldOptions := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"network":"internet"}`}
	config.OptionMapRWMutex.Unlock()
	defer func() {
		model.DB = oldDB
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldOptions
		config.OptionMapRWMutex.Unlock()
	}()
	if err = db.AutoMigrate(&model.Option{}, &model.AdminOperationLog{}); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(middleware.AdminOperationLog())
	router.PUT("/api/option/", func(c *gin.Context) {
		c.Set(ctxkey.Role, model.RoleRootUser)
		c.Set(ctxkey.Id, 1)
		c.Set(ctxkey.Username, "reward-admin")
		UpdateOption(c)
	})
	send := func(raw string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(model.Option{Key: "SystemDeploymentSettings", Value: raw})
		req := httptest.NewRequest("PUT", "/api/option/", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	valid := `{"network":"internet","creditRewards":{"registration":{"enabled":true,"amount":2000},"login":{"enabled":true,"amount":100,"intervalDays":7}},"padding":"` + strings.Repeat("x", 2200) + `"}`
	if w := send(valid); w.Code != 200 || !strings.Contains(w.Body.String(), `"success":true`) {
		t.Fatal(w.Body.String())
	}
	var option model.Option
	if err = db.First(&option, "key = ?", "SystemDeploymentSettings").Error; err != nil || option.Value != valid {
		t.Fatalf("settings not persisted: %v", err)
	}
	var logs []model.AdminOperationLog
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		db.Find(&logs)
		if len(logs) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(logs) != 1 || logs[0].AdminUsername != "reward-admin" || !strings.Contains(logs[0].Detail, `"intervalDays":7`) || !strings.Contains(logs[0].Detail, `"before":null`) {
		t.Fatalf("missing rule audit: %+v", logs)
	}
	if w := send(`{"network":"internet","creditRewards":null}`); w.Code != 400 {
		t.Fatal("invalid rules accepted")
	}
	db.First(&option, "key = ?", "SystemDeploymentSettings")
	if option.Value != valid {
		t.Fatal("invalid rules overwrote saved settings")
	}
	if err = db.Migrator().DropTable(&model.Option{}); err != nil {
		t.Fatal(err)
	}
	if w := send(strings.Replace(valid, `"intervalDays":7`, `"intervalDays":14`, 1)); w.Code != 500 {
		t.Fatal("database failure reported as success")
	}
	config.OptionMapRWMutex.RLock()
	cached := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	if cached != valid {
		t.Fatal("failed save changed active configuration")
	}
}
