package controller

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	dbmodel "github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/billing/price"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCreditBillingActualBalanceReceiptAndFailureRefund(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldLog, oldSQLite, oldRedis, oldBatch := dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled, config.BatchUpdateEnabled
	dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled, config.BatchUpdateEnabled = db, db, true, false, false
	defer func() {
		dbmodel.DB, dbmodel.LOG_DB, common.UsingSQLite, common.RedisEnabled, config.BatchUpdateEnabled = oldDB, oldLog, oldSQLite, oldRedis, oldBatch
	}()
	if err = db.AutoMigrate(&dbmodel.User{}, &dbmodel.UserTimedQuota{}, &dbmodel.Token{}, &dbmodel.Log{}, &dbmodel.Channel{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&dbmodel.User{Id: 1, Username: "billing-test", Quota: 1500, TimedQuotaTotal: 1500})
	db.Create(&dbmodel.UserTimedQuota{UserId: 1, Amount: 1500, Remaining: 1500, Source: dbmodel.TimedQuotaSourceAdmin})
	db.Create(&dbmodel.Token{Id: 1, UserId: 1, Key: "billing-test", RemainQuota: 1500})
	meta := &meta.Meta{UserId: 1, TokenId: 1, ChannelId: 1, StartTime: time.Now(), CreditSessionID: "session-credit-test",
		CreditPrice: &price.Snapshot{Version: 1, Source: "configured", Model: "test", Base: 1, Input: 0.15, Output: 0.6, CacheRead: 0.03, CacheWrite: 0.15, Group: 1, QuotaPerUnit: 1000}}
	request := &model.GeneralOpenAIRequest{Model: "test", MaxTokens: 500}
	reserved, bizErr := preConsumeQuota(context.Background(), request, 1000, 1, meta)
	if bizErr != nil {
		t.Fatal(bizErr)
	}
	if reserved != 450 {
		t.Fatalf("reserved %d", reserved)
	}
	postConsumeQuota(context.Background(), &model.Usage{PromptTokens: 1000, CompletionTokens: 500, PromptTokensDetails: &model.PromptTokensDetails{CachedTokens: 800}}, meta, request, 1, reserved, 1, 1, false)
	var user dbmodel.User
	var token dbmodel.Token
	var log dbmodel.Log
	db.First(&user, 1)
	db.First(&token, 1)
	db.First(&log)
	if user.Quota != 1146 || token.RemainQuota != 1146 || log.Quota != 354 {
		t.Fatalf("balance mismatch user=%d token=%d log=%d", user.Quota, token.RemainQuota, log.Quota)
	}
	var receipt price.Receipt
	if err = json.Unmarshal([]byte(log.CreditBilling), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.CacheReadTokens != 800 || receipt.InputTokens != 200 || receipt.SessionID != "session-credit-test" || receipt.Status != "settled" {
		t.Fatalf("incorrect receipt %+v", receipt)
	}
	reserved, bizErr = preConsumeQuota(context.Background(), request, 1000, 1, meta)
	if bizErr != nil {
		t.Fatal(bizErr)
	}
	returnPreConsumedQuota(context.Background(), reserved, meta)
	db.First(&user, 1)
	db.First(&token, 1)
	if user.Quota != 1146 || token.RemainQuota != 1146 {
		t.Fatal("failed request not refunded")
	}
	_, bizErr = preConsumeQuota(context.Background(), request, 100000, 1, meta)
	if bizErr == nil {
		t.Fatal("insufficient funds accepted")
	}
	db.First(&user, 1)
	if user.Quota != 1146 {
		t.Fatal("failed reservation changed balance")
	}

	// Exercise the actual relay/adaptor HTTP path, including upstream failure.
	oldApproximate := config.ApproximateTokenEnabled
	oldClient := client.HTTPClient
	client.HTTPClient = http.DefaultClient
	defer func() { client.HTTPClient = oldClient }()
	config.ApproximateTokenEnabled = true
	defer func() { config.ApproximateTokenEnabled = oldApproximate }()
	config.OptionMapRWMutex.Lock()
	oldOptions := config.OptionMap
	config.OptionMap = map[string]string{price.OptionKey: `{"test":{"input":0.15,"output":0.6,"cache_read":0.03,"cache_write":0.15}}`, "SystemDeploymentSettings": `{"edition":"operations","creditPricingBase":1}`}
	config.OptionMapRWMutex.Unlock()
	defer func() {
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldOptions
		config.OptionMapRWMutex.Unlock()
	}()
	if err = db.AutoMigrate(&dbmodel.UserPromptAudit{}); err != nil {
		t.Fatal(err)
	}
	upstreamFailed := false
	upstreamStream := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if upstreamFailed {
			w.WriteHeader(503)
			io.WriteString(w, `{"error":{"message":"unavailable","type":"server_error"}}`)
			return
		}
		if upstreamStream {
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, "data: "+`{"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"}}]}`+"\n\n"+
				"data: "+`{"id":"test","choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500,"prompt_tokens_details":{"cached_tokens":800}}}`+"\n\ndata: [DONE]\n\n")
			return
		}
		io.WriteString(w, `{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500,"prompt_tokens_details":{"cached_tokens":800}}}`)
	}))
	defer upstream.Close()
	for _, scenario := range []struct {
		fail, stream bool
		balance      int64
	}{{false, false, 792}, {false, true, 438}, {true, false, 438}} {
		upstreamFailed, upstreamStream = scenario.fail, scenario.stream
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		body := `{"model":"test","max_tokens":500,"messages":[{"role":"user","content":"hello"}]}`
		if scenario.stream {
			body = strings.TrimSuffix(body, "}") + `,"stream":true}`
		}
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set(ctxkey.Id, 1)
		c.Set(ctxkey.TokenId, 1)
		c.Set(ctxkey.ChannelId, 1)
		c.Set(ctxkey.Channel, 1)
		c.Set(ctxkey.BaseURL, upstream.URL)
		c.Set(ctxkey.Group, "default")
		bizErr = RelayTextHelper(c)
		if scenario.fail != (bizErr != nil) {
			t.Fatalf("relay failure=%t err=%+v", scenario.fail, bizErr)
		}
		db.First(&user, 1)
		db.First(&token, 1)
		if user.Quota != scenario.balance || token.RemainQuota != scenario.balance {
			t.Fatalf("HTTP relay mismatch: scenario=%+v user=%d token=%d", scenario, user.Quota, token.RemainQuota)
		}
	}
}
