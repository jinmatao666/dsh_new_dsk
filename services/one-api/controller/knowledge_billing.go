package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
)

// knowledgeBilling forwards the existing authenticated request to the unified HTTP API.
// It does not choose charging policies or implicitly charge a question.
type knowledgeBilling struct {
	userID        int
	itemID        string
	authorization string
	cookie        string
	origin        string
	context       context.Context
}

type knowledgeBillingResponse struct {
	Success bool            `json:"success"`
	Code    string          `json:"code"`
	Data    json.RawMessage `json:"data"`
	Token   string          `json:"task_token"`
}

type knowledgeBillingQuote struct {
	Rule   model.BillingRule `json:"rule"`
	Exempt bool              `json:"exempt"`
}

type knowledgeBillingTask struct {
	model.BillingTask
	Exempt bool `json:"exempt"`
}

func knowledgeBillingFor(c *gin.Context, base *model.KnowledgeBase) knowledgeBilling {
	b := knowledgeBilling{userID: c.GetInt("id"), itemID: strconv.Itoa(base.Id), origin: fmt.Sprintf("http://127.0.0.1:%d", *common.Port), context: context.Background()}
	if port, err := strconv.Atoi(os.Getenv("PORT")); err == nil && port > 0 && port <= 65535 {
		b.origin = fmt.Sprintf("http://127.0.0.1:%d", port)
	}
	if c.Request != nil {
		b.authorization = c.GetHeader("Authorization")
		b.cookie = c.GetHeader("Cookie")
		b.context = c.Request.Context()
	}
	return b
}

func (b knowledgeBilling) call(path string, body interface{}, taskToken string) (knowledgeBillingResponse, error) {
	var result knowledgeBillingResponse
	var data io.Reader
	method := "GET"
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return result, err
		}
		data = bytes.NewReader(raw)
		method = "POST"
	}
	// Settlement can outlive a cancelled browser request; bounded timeout still applies.
	ctx := b.context
	if taskToken != "" {
		ctx = context.WithoutCancel(ctx)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, b.origin+"/api/billing/v1/"+path, data)
	if err != nil {
		return result, err
	}
	req.Header.Set("Content-Type", "application/json")
	if taskToken != "" {
		req.Header.Set("Authorization", "Bearer "+taskToken)
	} else {
		req.Header.Set("Authorization", b.authorization)
		req.Header.Set("Cookie", b.cookie)
	}
	client := http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return result, err
	}
	defer res.Body.Close()
	if err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&result); err != nil {
		return result, err
	}
	if res.StatusCode != 200 || !result.Success {
		if result.Code == "" {
			result.Code = "BILLING_UNAVAILABLE"
		}
		return result, errors.New(result.Code)
	}
	return result, nil
}

func (b knowledgeBilling) Quote(pointID string) (knowledgeBillingQuote, error) {
	var quote knowledgeBillingQuote
	if config.CreditsDisabled() {
		quote.Exempt = true
		return quote, nil
	}
	if pointID == "" {
		return quote, errors.New("INVALID_REQUEST")
	}
	value, err := b.call("quote?"+url.Values{"kind": {"knowledge"}, "item_id": {b.itemID}, "charge_point_id": {pointID}}.Encode(), nil, "")
	if err == nil {
		err = json.Unmarshal(value.Data, &quote)
	}
	return quote, err
}

func (b knowledgeBilling) Reserve(pointID, requestID string, quantity, version int64) (knowledgeBillingTask, string, error) {
	var task knowledgeBillingTask
	if config.CreditsDisabled() {
		task.Exempt = true
		task.State = "exempt"
		return task, "", nil
	}
	value, err := b.call("tasks", map[string]interface{}{"mode": "configured", "kind": "knowledge", "item_id": b.itemID, "charge_point_id": pointID, "request_id": requestID, "quantity": quantity, "version": version}, "")
	if err == nil {
		err = json.Unmarshal(value.Data, &task)
	}
	return task, value.Token, err
}

func (b knowledgeBilling) Finish(taskID, token, status string) (model.BillingTask, error) {
	var task model.BillingTask
	if taskID == "" || token == "" {
		return task, errors.New("INVALID_REQUEST")
	}
	value, err := b.call("tasks/"+url.PathEscape(taskID)+"/result", map[string]string{"status": status}, token)
	if err == nil {
		err = json.Unmarshal(value.Data, &task)
	}
	return task, err
}

func (b knowledgeBilling) Get(taskID string) (model.BillingTask, error) {
	var task model.BillingTask
	value, err := b.call("tasks/"+url.PathEscape(taskID), nil, "")
	if err == nil {
		err = json.Unmarshal(value.Data, &task)
	}
	return task, err
}

func prepareKnowledgeBilling(c *gin.Context, base *model.KnowledgeBase) {
	c.Set("knowledge.billing", knowledgeBillingFor(c, base))
}
