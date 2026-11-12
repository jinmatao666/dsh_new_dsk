package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
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
