package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http/httptest"
	"testing"
)

func TestDesktopTurnCreditsIsolationAndHistory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { sqlDB.Close() })
	oldDB, oldLogs, oldUnit := model.DB, model.LOG_DB, config.QuotaPerUnit
	model.DB, model.LOG_DB, config.QuotaPerUnit = db, db, 1000
	config.OptionMapRWMutex.Lock()
	oldMap := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"edition":"operational","creditsEnabled":true}`}
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		model.DB, model.LOG_DB, config.QuotaPerUnit = oldDB, oldLogs, oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldMap
		config.OptionMapRWMutex.Unlock()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.BillingTask{}, &model.UserTimedQuota{}, &model.DesktopCheckinReceipt{}, &model.AdminCreditGrant{}, &model.KnowledgeCreditReceipt{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "payer", Quota: 9000}).Error)
	turn, otherTurn := 1, 2
	for _, row := range []model.Log{
		{UserId: 1, Type: model.LogTypeConsume, ModelName: "qwen3.6-plus", Quota: 1250, CreditSessionID: "session-a", CreditTurnID: &turn},
		{UserId: 2, Type: model.LogTypeConsume, ModelName: "other-user", Quota: 9000, CreditSessionID: "session-a", CreditTurnID: &turn},
		{UserId: 1, Type: model.LogTypeConsume, ModelName: "other-turn", Quota: 500, CreditSessionID: "session-a", CreditTurnID: &otherTurn},
		{UserId: 1, Type: model.LogTypeConsume, ModelName: "other-session", Quota: 500, CreditSessionID: "session-b", CreditTurnID: &turn},
	} {
		require.NoError(t, db.Create(&row).Error)
	}
	for _, row := range []model.BillingTask{
		{ID: "skill-paid", UserID: 1, RequestID: "a", Kind: "skill", ItemID: "contract", Action: "default", Quota: 2000, State: "succeeded", SessionID: "session-a", TurnID: &turn, BalanceAfter: 9000},
		{ID: "expert-paid", UserID: 1, RequestID: "b", Kind: "expert", ItemID: "report", Action: "report", Description: "生成报告", Quota: 3000, State: "succeeded", SessionID: "session-a", TurnID: &turn},
		{ID: "knowledge-paid", UserID: 1, RequestID: "c", Kind: "knowledge", ItemID: "20", Action: "question", Quota: 1000, State: "succeeded", SessionID: "session-a", TurnID: &turn},
		{ID: "failed", UserID: 1, RequestID: "d", Kind: "skill", Quota: 9999, State: "failed", SessionID: "session-a", TurnID: &turn},
		{ID: "pending", UserID: 1, RequestID: "e", Kind: "skill", Quota: 9999, State: "reserved", SessionID: "session-a", TurnID: &turn},
		{ID: "free", UserID: 1, RequestID: "f", Kind: "skill", State: "succeeded", SessionID: "session-a", TurnID: &turn},
		{ID: "other-user", UserID: 2, RequestID: "g", Kind: "skill", Quota: 9999, State: "succeeded", SessionID: "session-a", TurnID: &turn},
	} {
		require.NoError(t, db.Create(&row).Error)
	}
	call := func(path string, handler gin.HandlerFunc) string {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", path, nil)
		c.Set(ctxkey.Id, 1)
		handler(c)
		require.Equal(t, 200, w.Code, w.Body.String())
		return w.Body.String()
	}
	var summary struct {
		Data struct {
			Enabled bool
			Credits float64
			Pending bool
			Items   []desktopCreditItem
		}
	}
	body := call("/?session_id=session-a&turn_id=1", GetDesktopTurnCredits)
	require.NoError(t, json.Unmarshal([]byte(body), &summary))
	require.True(t, summary.Data.Enabled)
	require.True(t, summary.Data.Pending)
	require.Equal(t, 7.25, summary.Data.Credits)
	require.Len(t, summary.Data.Items, 4)
	require.NotContains(t, body, "other-user")
	require.NotContains(t, body, "other-turn")
	require.NotContains(t, body, "other-session")
	require.Contains(t, body, "技能调用 · contract")
	require.Contains(t, body, "专家调用 · report")
	require.Contains(t, body, "知识库调用 · 20")
	spent := call("/?filter=spent", GetDesktopCredits)
	require.Contains(t, spent, "business-skill-paid")
	require.Contains(t, spent, "business-expert-paid")
	require.Contains(t, spent, "business-knowledge-paid")
	require.NotContains(t, spent, "business-failed")
	require.NotContains(t, spent, "business-pending")
	require.NotContains(t, spent, "business-free")
	earned := call("/?filter=earned", GetDesktopCredits)
	require.NotContains(t, earned, "business-")
	config.OptionMapRWMutex.Lock()
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"operational","billing":{"enabled":false}}`
	config.OptionMapRWMutex.Unlock()
	disabled := call("/?session_id=session-a&turn_id=1", GetDesktopTurnCredits)
	require.Contains(t, disabled, `"enabled":false`)
	require.NotContains(t, disabled, "items")
}
