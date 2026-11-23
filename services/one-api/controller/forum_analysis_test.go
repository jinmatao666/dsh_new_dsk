package controller

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestForumCreditConfigurationAndAnalysisHTTP(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "forum.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	oldDB, oldSQLite, oldRedis, oldUnit := model.DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit
	model.DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit = db, true, false, 1000
	config.OptionMapRWMutex.Lock()
	oldMap := config.OptionMap
	config.OptionMap = map[string]string{"SystemDeploymentSettings": `{"edition":"operations","billing":{"enabled":true}}`}
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		model.DB, common.UsingSQLite, common.RedisEnabled, config.QuotaPerUnit = oldDB, oldSQLite, oldRedis, oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap = oldMap
		config.OptionMapRWMutex.Unlock()
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserTimedQuota{}, &model.BillingRule{}, &model.BillingTask{}, &model.ForumAnalysis{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "forum-payer", Quota: 10000, TimedQuotaTotal: 10000}).Error)
	require.NoError(t, db.Create(&model.UserTimedQuota{UserId: 1, Amount: 10000, Remaining: 10000, Source: model.TimedQuotaSourceAdmin}).Error)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("id", 1) })
	r.GET("/prices", GetForumCreditSettings)
	r.PUT("/prices", PutForumCreditSettings)
	r.POST("/quote", QuoteForumAnalysis)
	r.POST("/begin", BeginForumAnalysis)
	r.POST("/result/:id", FinishForumAnalysis)
	call := func(method, path string, input interface{}) (int, map[string]interface{}) {
		body, err := json.Marshal(input)
		require.NoError(t, err)
		request := httptest.NewRequest(method, path, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		r.ServeHTTP(response, request)
		var data map[string]interface{}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &data))
		return response.Code, data
	}
	status, response := call("GET", "/prices", nil)
	require.Equal(t, 200, status)
	prices := response["data"].(map[string]interface{})
	require.Equal(t, float64(1), prices["qa"].(map[string]interface{})["credits"])
	configured := map[string]interface{}{"qa": forumPrice{Credits: "2", Version: 1}, "report": forumPrice{Credits: "3", Version: 1}}
	status, _ = call("PUT", "/prices", configured)
	require.Equal(t, 200, status)
	status, _ = call("PUT", "/prices", configured)
	require.Equal(t, 409, status)
	question := map[string]interface{}{"item": map[string]string{"id": "a1", "type": "article"}, "question": "核心要点是什么", "action": "qa"}
	status, response = call("POST", "/quote", question)
	require.Equal(t, 200, status)
	require.Equal(t, float64(2), response["data"].(map[string]interface{})["credits"])
	question["session_id"], question["managed_model"], question["version"] = "http-desktop-session", "selected-model", 1
	status, _ = call("POST", "/begin", question)
	require.Equal(t, 409, status)
	question["version"] = 2
	status, response = call("POST", "/begin", question)
	require.Equal(t, 200, status)
	row := response["data"].(map[string]interface{})
	status, _ = call("POST", "/result/"+row["id"].(string), map[string]interface{}{"lease": response["lease"], "status": "succeeded", "text": "原答案", "provider": "managed", "model": "selected-model"})
	require.Equal(t, 200, status)
	status, response = call("POST", "/quote", question)
	require.Equal(t, 200, status)
	require.Equal(t, float64(0), response["data"].(map[string]interface{})["credits"])
	require.Equal(t, true, response["data"].(map[string]interface{})["cached"])
	question["session_id"] = "another-http-session"
	status, response = call("POST", "/begin", question)
	require.Equal(t, 200, status)
	require.Equal(t, "原答案", response["data"].(map[string]interface{})["text"])
	require.Empty(t, response["lease"])
	var user model.User
	require.NoError(t, db.First(&user, 1).Error)
	require.Equal(t, int64(8000), user.Quota)
	question["action"] = "report"
	question["question"] = "请生成本文分析报告"
	status, response = call("POST", "/quote", question)
	require.Equal(t, 200, status)
	require.Equal(t, float64(3), response["data"].(map[string]interface{})["credits"])
	status, _ = call("PUT", "/prices", map[string]interface{}{"qa": forumPrice{Credits: "-1", Version: 2}, "report": forumPrice{Credits: "3", Version: 2}})
	require.Equal(t, 400, status)
}

func TestForumBillingInfersReportFromQuestion(t *testing.T) {
	for _, test := range []struct{ question, expected string }{
		{"帮我生成一份自然资源规划分析报告", "report"},
		{"请撰写本文的研究报告", "report"},
		{"出具一份评估报告", "report"},
		{"write an analysis report", "report"},
		{"这份报告的核心观点是什么", "qa"},
		{"全文结构梳理", "qa"},
	} {
		input := forumQuestion{Question: test.question, Action: "report"}
		input.Item.ID, input.Item.Type = "a1", "article"
		_, err := input.key()
		require.NoError(t, err)
		require.Equal(t, test.expected, input.Action, test.question)
	}
}
