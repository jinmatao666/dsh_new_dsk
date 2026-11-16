package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestKnowledgeBillingExtensionHasNoImplicitCharge(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("id", 42)
	// No database is needed: preparing the extension must not quote, reserve or charge.
	prepareKnowledgeBilling(c, &model.KnowledgeBase{Id: 7})
	value, ok := c.Get("knowledge.billing")
	if !ok {
		t.Fatal("missing knowledge billing adapter")
	}
	adapter, ok := value.(knowledgeBilling)
	if !ok || adapter.userID != 42 || adapter.itemID != "7" {
		t.Fatalf("wrong identity: %#v", value)
	}
	if _, err := adapter.Quote(""); err == nil {
		t.Fatal("empty action accepted")
	}
}

func TestKnowledgeBillingUsesUnifiedHTTP(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path == "/api/billing/v1/tasks/task-one/result" {
			if r.Header.Get("Authorization") != "Bearer task-secret" || r.Header.Get("Cookie") != "" {
				t.Error("settlement identity incorrect")
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": map[string]string{"id": "task-one", "state": "succeeded"}})
			return
		}
		if r.Header.Get("Authorization") != "Bearer user-auth" || r.Header.Get("Cookie") != "session=existing" {
			t.Error("existing auth was not forwarded")
		}
		if r.Method == "GET" {
			if r.URL.Query().Get("kind") != "knowledge" || r.URL.Query().Get("item_id") != "7" || r.URL.Query().Get("charge_point_id") != "cp_qa" {
				t.Error(r.URL)
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": map[string]interface{}{"rule": map[string]interface{}{"id": "cp_qa", "version": 2}, "exempt": false}})
			return
		}
		var input map[string]interface{}
		json.NewDecoder(r.Body).Decode(&input)
		if input["kind"] != "knowledge" || input["item_id"] != "7" || input["charge_point_id"] != "cp_qa" || input["request_id"] != "qa-001" {
			t.Error(input)
		}
		if _, ok := input["points"]; ok {
			t.Error("caller-supplied price")
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": map[string]string{"id": "task-one", "state": "reserved"}, "task_token": "task-secret"})
	}))
	defer server.Close()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/ask", nil)
	c.Request.Header.Set("Authorization", "Bearer user-auth")
	c.Request.Header.Set("Cookie", "session=existing")
	billing := knowledgeBillingFor(c, &model.KnowledgeBase{Id: 7})
	billing.origin = server.URL
	quote, err := billing.Quote("cp_qa")
	if err != nil || quote.Rule.Version != 2 {
		t.Fatal(quote, err)
	}
	task, token, err := billing.Reserve("cp_qa", "qa-001", 1, quote.Rule.Version)
	if err != nil || task.ID != "task-one" {
		t.Fatal(task, err)
	}
	result, err := billing.Finish(task.ID, token, "succeeded")
	if err != nil || result.State != "succeeded" {
		t.Fatal(result, err)
	}
	if calls != 3 {
		t.Fatal(calls)
	}
}
