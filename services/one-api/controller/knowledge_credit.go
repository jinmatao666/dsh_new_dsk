package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
)

func knowledgeCreditFailure(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"success": false, "message": err.Error()})
}

// GetKnowledgeCreditSettings exposes the current share and operations-edition availability.
func GetKnowledgeCreditSettings(c *gin.Context) {
	enabled, _, err := model.KnowledgeCreditPolicy()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	settings, err := model.ReadKnowledgeCreditSettings()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": enabled, "platform_percent": settings.Percent, "limits": settings.Limits}})
}

// UpdateManagedKnowledgeCreditSettings persists an administrator's percentage for subsequent uses.
func UpdateManagedKnowledgeCreditSettings(c *gin.Context) {
	if !knowledgeReviewAdmin(c) {
		return
	}
	enabled, _, err := model.KnowledgeCreditPolicy()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	if !enabled {
		knowledgeCreditFailure(c, 403, errors.New("仅启用积分的运营版支持知识库分成设置"))
		return
	}
	var input struct {
		Percent *int `json:"platform_percent"`
		Limits  *struct {
			Browse   *int64 `json:"browse_cents"`
			Question *int64 `json:"question_cents"`
			Download *int64 `json:"download_cents"`
		} `json:"limits"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Percent == nil || *input.Percent < 0 || *input.Percent > 100 ||
		input.Limits == nil || input.Limits.Browse == nil || input.Limits.Question == nil || input.Limits.Download == nil {
		knowledgeCreditFailure(c, 400, errors.New("请填写平台占比和三项最高积分"))
		return
	}
	limits := model.KnowledgeCreditLimits{BrowseCents: *input.Limits.Browse, QuestionCents: *input.Limits.Question, DownloadCents: *input.Limits.Download}
	settings := model.KnowledgeCreditSettings{Percent: *input.Percent, Limits: limits}
	if err := settings.Validate(); err != nil {
		knowledgeCreditFailure(c, 400, err)
		return
	}
	if err := model.SaveKnowledgeCreditSettings(settings); err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	GetKnowledgeCreditSettings(c)
}

// ListOwnedKnowledgeCreditPrices returns the caller's personal libraries published for subscription.
func ListOwnedKnowledgeCreditPrices(c *gin.Context) {
	enabled, _, err := model.KnowledgeCreditPolicy()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	type item struct {
		Id   int    `json:"id"`
		Name string `json:"name"`
		model.KnowledgeCreditPrice
	}
	items := []item{}
	if enabled {
		err := model.DB.Table("knowledge_bases AS b").
			Select("b.id, b.name, COALESCE(p.browse_cents, 0) AS browse_cents, COALESCE(p.question_cents, 0) AS question_cents, COALESCE(p.download_cents, 0) AS download_cents").
			Joins("LEFT JOIN knowledge_credit_prices p ON p.knowledge_base_id = b.id").
			Where("b.owner_user_id = ? AND b.kind = ? AND b.category_id = 0 AND b.publication_scope = ?", c.GetInt("id"), model.KnowledgeBasePersonal, "subscription").
			Order("b.id").Scan(&items).Error
		if err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
	}
	settings, err := model.ReadKnowledgeCreditSettings()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	for i := range items {
		items[i].KnowledgeCreditPrice = settings.Limits.LimitPrice(items[i].KnowledgeCreditPrice)
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": enabled, "platform_percent": settings.Percent, "limits": settings.Limits, "items": items}})
}

// GetKnowledgeCreditPrice returns the owner's saved draft or a viewer's billable prices.
func GetKnowledgeCreditPrice(c *gin.Context) {
	base, ok := authorizedKnowledgeBase(c)
	if !ok {
		return
	}
	enabled, _, err := model.KnowledgeCreditPolicy()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	applies, err := model.KnowledgeCreditApplies(base, c.GetInt("id"))
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	var price model.KnowledgeCreditPrice
	configured := false
	if enabled && (applies || base.OwnerUserId == c.GetInt("id")) {
		price, configured, err = model.GetKnowledgeCreditPrice(base.Id)
		if err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
	}
	var until time.Time
	if applies && c.Query("document_id") != "" {
		until, err = model.KnowledgePreviewPaidUntil(c.GetInt("id"), base.Id, c.Query("document_id"))
		if err != nil {
			knowledgeCreditFailure(c, 500, err)
			return
		}
	}
	settings, err := model.ReadKnowledgeCreditSettings()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	price = settings.Limits.LimitPrice(price)
	c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": enabled, "applies": applies, "configured": configured, "platform_percent": settings.Percent, "limits": settings.Limits, "price": price, "preview_free": until.After(time.Now())}})
}

// PutKnowledgeCreditPrice saves all three owner prices in hundredths before or after publication.
func PutKnowledgeCreditPrice(c *gin.Context) {
	base, ok := publicationBase(c)
	if !ok {
		return
	}
	enabled, _, err := model.KnowledgeCreditPolicy()
	if err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	if !enabled {
		knowledgeCreditFailure(c, 403, errors.New("当前版本未启用知识库积分"))
		return
	}
	var input struct {
		Browse   *int64 `json:"browse_cents"`
		Question *int64 `json:"question_cents"`
		Download *int64 `json:"download_cents"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Browse == nil || input.Question == nil || input.Download == nil {
		knowledgeCreditFailure(c, 400, errors.New("请填写三项知识库积分单价"))
		return
	}
	err = model.SaveKnowledgeCreditPrice(c.GetInt("id"), base.Id, model.KnowledgeCreditPrice{BrowseCents: *input.Browse, QuestionCents: *input.Question, DownloadCents: *input.Download})
	if err != nil {
		knowledgeCreditFailure(c, 400, err)
		return
	}
	GetKnowledgeCreditPrice(c)
}

func knowledgeCreditRequestId(value string) (string, error) {
	if value == "" {
		return uuid.NewString(), nil
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return "", errors.New("知识库使用编号无效")
	}
	return id.String(), nil
}

func knowledgeCreditHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func knowledgeCreditDocuments(citations []ragflow.Citation) []model.KnowledgeCreditDocument {
	result := make([]model.KnowledgeCreditDocument, 0, len(citations))
	for _, citation := range citations {
		if citation.DocumentId != "" {
			result = append(result, model.KnowledgeCreditDocument{Id: citation.DocumentId, Name: citation.DocumentName})
		}
	}
	return result
}

func beginMeteredKnowledgeQuestion(c *gin.Context, base *model.KnowledgeBase, conversation model.KnowledgeConversation, question string, docIds []string) (string, string, string, error) {
	requestId, err := knowledgeCreditRequestId(c.GetHeader("Idempotency-Key"))
	if err != nil {
		return "", "", "", err
	}
	userId := c.GetInt("id")
	fingerprint, _ := json.Marshal([]interface{}{base.Id, question, docIds})
	key := knowledgeCreditHash(fmt.Sprintf("%d:%s", userId, requestId))
	saved, err := model.BeginKnowledgeCreditQuestion(&model.KnowledgeCreditQuestion{Key: key, UserId: userId, BaseId: base.Id, SessionId: conversation.RagflowSessionId, Fingerprint: knowledgeCreditHash(string(fingerprint))}, conversation.Id)
	return requestId, key, saved, err
}

func writeMeteredKnowledgeAnswer(c *gin.Context, stream bool, answer string) {
	if !stream {
		c.Data(http.StatusOK, "application/json", []byte(`{"success":true,"data":`+answer+`}`))
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(answer), &data); err != nil {
		knowledgeCreditFailure(c, 500, err)
		return
	}
	data["done"] = true
	payload, _ := json.Marshal(data)
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-store")
	c.String(http.StatusOK, "data: %s\n\n", payload)
}
