package controller

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// knowledgeBilling is the knowledge module's adapter to the shared billing service.
// It contains identity only: never prompts, documents, RAGFlow keys or assumed token usage.
// Creating this adapter does not reserve or charge any credits.
type knowledgeBilling struct {
	userID int
	itemID string
}

func knowledgeBillingFor(c *gin.Context, base *model.KnowledgeBase) knowledgeBilling {
	return knowledgeBilling{userID: c.GetInt("id"), itemID: strconv.Itoa(base.Id)}
}

// Quote selects a future knowledge-owned action, such as qa or parse.
// Missing rules are not implicitly converted to a default per-use fee.
func (b knowledgeBilling) Quote(action string) (model.BillingRule, error) {
	if b.userID <= 0 || action == "" {
		return model.BillingRule{}, errors.New("INVALID_REQUEST")
	}
	return model.ResolveBusinessRule(model.DB, "knowledge", b.itemID, action)
}

// Reserve must be called only after a future business rule obtains user confirmation.
// The request ID and quote version must remain stable across retries.
func (b knowledgeBilling) Reserve(action, requestID string, quantity, version int64) (model.BillingTask, string, error) {
	if b.userID <= 0 {
		return model.BillingTask{}, "", errors.New("INVALID_REQUEST")
	}
	return model.ReserveBillingTask(b.userID, model.BillingTask{
		Kind: "knowledge", ItemID: b.itemID, Action: action, RequestID: requestID, Quantity: quantity, Version: version,
	})
}

// Finish uses the same settlement path as experts and skills.
// Business code must decide success explicitly, not infer it from HTTP 200 on an SSE stream.
func (b knowledgeBilling) Finish(taskID, taskToken, status string) (model.BillingTask, error) {
	var task model.BillingTask
	if err := model.DB.Where("id = ? AND user_id = ? AND kind = ? AND item_id = ?", taskID, b.userID, "knowledge", b.itemID).First(&task).Error; err != nil {
		return task, err
	}
	return model.SettleBillingTask(taskID, taskToken, status, false)
}

// prepareKnowledgeBilling marks the shared answer boundary for follow-up development.
// Both one-shot and streaming asks, including existing conversations, pass this point.
// No rule is selected and no money is moved until the knowledge team adds explicit policy.
func prepareKnowledgeBilling(c *gin.Context, base *model.KnowledgeBase) {
	c.Set("knowledge.billing", knowledgeBillingFor(c, base))
}

// ReservePoints supports trusted knowledge business code calculating its own fixed total.
// Caller must already authorize the current base and obtain the user's payment consent.
func (b knowledgeBilling) ReservePoints(action, requestID, points, description string) (model.BillingTask, string, error) {
	if b.userID <= 0 || action == "" || len(action) > 80 || len([]rune(description)) > 160 {
		return model.BillingTask{}, "", errors.New("INVALID_REQUEST")
	}
	return model.ReserveDeveloperBilling(b.userID, model.BillingTask{Kind: "knowledge", ItemID: b.itemID, Action: action, RequestID: requestID, Description: description}, points)
}
