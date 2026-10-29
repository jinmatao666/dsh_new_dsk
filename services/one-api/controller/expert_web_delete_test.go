package controller

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm/clause"
)

func TestExpertWebDeleteRemovesTicketsAndPreservesHistory(t *testing.T) {
	router := expertWebTestRouter(t)
	credential := expertWebCreatePublished(t, router)
	ticket := expertWebLaunch(t, router)
	if err := model.DB.AutoMigrate(&model.UsageEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := model.DB.Create(&model.UsageEvent{EventID: "retained-event", Kind: "expert", ItemID: "brand-new-expert", ItemName: "独立专家"}).Error; err != nil {
		t.Fatal(err)
	}
	other := model.ExpertWebProfile{Key: "other-expert", Name: "Other", Provider: "Other", WorkbenchURL: "https://other.test/"}
	if err := model.DB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	if err := model.DB.Create(&model.ExpertWebTicket{Hash: "other-ticket", ExpertKey: other.Key}).Error; err != nil {
		t.Fatal(err)
	}
	response := expertWebRequest(router, http.MethodDelete, "/brand-new-expert", "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", response.Code, response.Body.String())
	}
	var count int64
	for name, query := range map[string]interface{}{"profile": &model.ExpertWebProfile{}, "ticket": &model.ExpertWebTicket{}} {
		column := "key"
		if name == "ticket" {
			column = "expert_key"
		}
		if err := model.DB.Model(query).Where(clause.Eq{Column: column, Value: "brand-new-expert"}).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("%s remains: count=%d error=%v", name, count, err)
		}
	}
	if err := model.DB.Model(&model.UsageEvent{}).Where("event_id = ?", "retained-event").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("history lost: count=%d error=%v", count, err)
	}
	if err := model.DB.Model(&model.ExpertWebProfile{}).Where("\"key\" = ?", other.Key).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("unrelated expert lost: count=%d error=%v", count, err)
	}
	if err := model.DB.Model(&model.ExpertWebTicket{}).Where("hash = ?", "other-ticket").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("unrelated ticket lost: count=%d error=%v", count, err)
	}
	if expertWebRequest(router, http.MethodPost, "/brand-new-expert/launch", "{}", "").Code != http.StatusNotFound {
		t.Fatal("deleted expert can still launch")
	}
	response = expertWebRequest(router, http.MethodPost, "/redeem", fmt.Sprintf(`{"ticket":%q}`, ticket), "Bearer "+credential)
	if response.Code == http.StatusOK {
		t.Fatal("deleted expert ticket still redeems")
	}
	if expertWebRequest(router, http.MethodDelete, "/brand-new-expert", "", "").Code != http.StatusNotFound {
		t.Fatal("missing expert did not return 404")
	}
}

func TestExpertWebDeleteRollsBackWhenTicketCleanupFails(t *testing.T) {
	router := expertWebTestRouter(t)
	expertWebCreatePublished(t, router)
	expertWebLaunch(t, router)
	if err := model.DB.Exec(`CREATE TRIGGER reject_ticket_delete BEFORE DELETE ON expert_web_tickets BEGIN SELECT RAISE(ABORT, 'test cleanup failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	response := expertWebRequest(router, http.MethodDelete, "/brand-new-expert", "", "")
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected failure: %d %s", response.Code, response.Body.String())
	}
	var count int64
	if err := model.DB.Model(&model.ExpertWebProfile{}).Where("\"key\" = ?", "brand-new-expert").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("registration not rolled back: count=%d error=%v", count, err)
	}
}
