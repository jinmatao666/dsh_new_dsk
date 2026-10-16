package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func usageTestDB(t *testing.T) {
	t.Helper()
	previous := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.User{}, &model.UsageEvent{}, &model.ExpertWebProfile{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{Id: 7, Username: "alice"}).Error; err != nil {
		t.Fatal(err)
	}
	model.DB = db
	t.Cleanup(func() { model.DB = previous; _ = sqlDB.Close() })
}

func TestUsageInputValidation(t *testing.T) {
	if !validUsageInput(usageInput{EventID: "send-1001", ItemID: "pdf-merge", ItemName: "PDF 合并", InvocationType: "user_explicit"}, "skill") {
		t.Fatal("valid skill event rejected")
	}
	if validUsageInput(usageInput{EventID: "bad", ItemID: "pdf-merge", ItemName: "PDF 合并", InvocationType: "model_auto"}, "skill") {
		t.Fatal("short event ID accepted")
	}
	if validUsageInput(usageInput{EventID: "expert-task-1001", UserID: 7, InvocationType: "model_auto"}, "expert") {
		t.Fatal("expert event accepted a skill invocation type")
	}
}

func usageRequest(handler gin.HandlerFunc, body map[string]interface{}, userID int, authorization string) *httptest.ResponseRecorder {
	payload, _ := json.Marshal(body)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	if authorization != "" {
		c.Request.Header.Set("Authorization", authorization)
	}
	c.Set("id", userID)
	handler(c)
	return recorder
}

func TestUsageSkillEventsCountRepeatedCallsButNotDeliveryRetries(t *testing.T) {
	usageTestDB(t)
	first := map[string]interface{}{"event_id": "send-1001", "item_id": "skill-a", "item_name": "技能 A", "invocation_type": "user_explicit", "user_id": 999}
	for _, event := range []map[string]interface{}{first, first, {"event_id": "call-1002", "item_id": "skill-a", "item_name": "技能 A", "invocation_type": "model_auto"}} {
		if response := usageRequest(RecordSkillUsage, event, 7, ""); response.Code != 200 {
			t.Fatalf("recording failed: %d %s", response.Code, response.Body.String())
		}
	}
	var rows []model.UsageEvent
	if err := model.DB.Order("event_id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].InvocationType != "model_auto" || rows[1].InvocationType != "user_explicit" || rows[1].UserID != 7 || rows[1].DepartmentID != nil {
		t.Fatalf("unexpected usage rows: %#v", rows)
	}
	if response := usageRequest(RecordSkillUsage, map[string]interface{}{"event_id": "bad", "item_id": "x", "item_name": "x", "invocation_type": "model_auto"}, 7, ""); response.Code != 400 {
		t.Fatalf("invalid event accepted: %d", response.Code)
	}
}

func TestUsageExpertRequiresMatchingProviderAndExistingUser(t *testing.T) {
	usageTestDB(t)
	secret := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	profile := model.ExpertWebProfile{Key: "expert-one", Name: "专家一", Provider: "wanwei", ProviderSecretHash: expertWebDigest(secret), Published: true, WorkbenchURL: "https://example.com"}
	if err := model.DB.Create(&profile).Error; err != nil {
		t.Fatal(err)
	}
	input := map[string]interface{}{"event_id": "task-1001", "user_id": 7}
	if response := usageRequest(RecordExpertUsage, input, 0, "Bearer bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"); response.Code != 401 {
		t.Fatalf("wrong provider accepted: %d", response.Code)
	}
	if response := usageRequest(RecordExpertUsage, input, 0, "Bearer "+secret); response.Code != 200 {
		t.Fatalf("provider rejected: %d %s", response.Code, response.Body.String())
	}
	var row model.UsageEvent
	if err := model.DB.First(&row, "event_id = ?", "task-1001").Error; err != nil {
		t.Fatal(err)
	}
	if row.Kind != "expert" || row.ItemID != "expert-one" || row.ItemName != "专家一" || row.UserID != 7 {
		t.Fatalf("unexpected expert row: %#v", row)
	}
}

func TestUsageStatsAndDetailsUseIndependentQueries(t *testing.T) {
	usageTestDB(t)
	for _, row := range []model.UsageEvent{
		{EventID: "usage-1", Kind: "skill", ItemID: "skill-a", ItemName: "技能 A", UserID: 7, Username: "alice", Day: "2026-09-29", OccurredAt: time.Now()},
		{EventID: "usage-2", Kind: "skill", ItemID: "skill-a", ItemName: "技能 A", UserID: 7, Username: "alice", Day: "2026-09-29", OccurredAt: time.Now()},
		{EventID: "usage-3", Kind: "skill", ItemID: "skill-b", ItemName: "技能 B", UserID: 7, Username: "alice", Day: "2026-09-30", OccurredAt: time.Now()},
	} {
		if err := model.DB.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct {
		handler gin.HandlerFunc
		want    string
	}{
		{GetUsageStats, `"total":3`}, {GetUsageDetails, `"total":3`},
	} {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/?kind=skill&from=2026-09-29&to=2026-09-30", nil)
		check.handler(context)
		if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(check.want)) {
			t.Fatalf("unexpected usage response: %d %s", recorder.Code, recorder.Body.String())
		}
	}
}
