package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	billingratio "github.com/songquanpeng/one-api/relay/billing/ratio"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestChannelModelRegistration(t *testing.T) {
	var driver gorm.Dialector = sqlite.Open(":memory:")
	schema := ""
	if dsn := os.Getenv("DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN"); dsn != "" {
		schema = "channel_registration_" + strconv.FormatInt(time.Now().UnixNano(), 10)
		driver = postgres.Open(dsn + " search_path=" + schema)
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	if err != nil && strings.Contains(err.Error(), "CGO_ENABLED=0") {
		t.Skip("requires SQLite CGO or PostgreSQL test DSN")
	}
	require.NoError(t, err)
	if schema != "" {
		require.NoError(t, db.Exec("CREATE SCHEMA "+schema).Error)
	}
	oldDB, oldLogDB := model.DB, model.LOG_DB
	model.DB, model.LOG_DB = db, db
	oldPG, oldSQLite := common.UsingPostgreSQL, common.UsingSQLite
	common.UsingPostgreSQL, common.UsingSQLite = schema != "", schema == ""
	oldOptions := config.OptionMap
	oldModelRatios, oldCompletionRatios := billingratio.ModelRatio2JSONString(), billingratio.CompletionRatio2JSONString()
	config.OptionMap = map[string]string{"ModelRatio": `{"unrelated":7}`, "CompletionRatio": `{"unrelated":8}`}
	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.UsingPostgreSQL, common.UsingSQLite = oldPG, oldSQLite
		config.OptionMap = oldOptions
		_ = billingratio.UpdateModelRatioByJSONString(oldModelRatios)
		_ = billingratio.UpdateCompletionRatioByJSONString(oldCompletionRatios)
		if schema != "" {
			db.Exec("DROP SCHEMA " + schema + " CASCADE")
		}
		sqlDB, _ := db.DB()
		sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.ModelDefinition{}, &model.Option{}, &model.Log{}))
	first := model.Channel{Name: "a", Models: "qwen,new-model,bad-ratio", Status: 1}
	second := model.Channel{Name: "b", Models: "qwen", Status: 1}
	require.NoError(t, db.Create(&first).Error)
	require.NoError(t, db.Create(&second).Error)
	engine := gin.New()
	engine.POST("/from_channel", RegisterChannelModel)
	engine.POST("/definition", AddModelDefinition)
	engine.POST("/channel", AddChannel)
	engine.POST("/source", AddModelChannelSource)
	engine.GET("/test", TestModelChannels)
	engine.GET("/channels", GetConfiguredModelChannels)
	call := func(method, path string, body interface{}) map[string]interface{} {
		encoded, marshalErr := json.Marshal(body)
		require.NoError(t, marshalErr)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(string(encoded)))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(w, req)
		var response map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		return response
	}
	payload := map[string]interface{}{"channel_id": first.Id, "definition": map[string]interface{}{"name": "qwen", "display_name": "原名称", "model_type": "chat", "enabled": true}, "model_ratio": 2, "completion_ratio": 3}
	catalog := call("GET", "/channels", nil)
	require.Equal(t, true, catalog["success"])
	require.Len(t, catalog["data"], 2)
	_, containsKey := catalog["data"].([]interface{})[0].(map[string]interface{})["key"]
	require.False(t, containsKey)
	created := call("POST", "/from_channel", payload)
	require.Equal(t, true, created["success"])
	require.Equal(t, "created", created["status"])
	require.Equal(t, false, created["data"].(map[string]interface{})["enabled"])
	require.Equal(t, "skipped", call("POST", "/from_channel", payload)["status"])
	payload["channel_id"] = second.Id
	payload["definition"] = map[string]interface{}{"name": "qwen", "display_name": "不应覆盖", "model_type": "chat"}
	payload["model_ratio"] = 99
	require.Equal(t, "bound", call("POST", "/from_channel", payload)["status"])
	definition, err := model.GetModelDefinitionByName("qwen")
	require.NoError(t, err)
	require.Equal(t, "原名称", definition.DisplayName)
	var option model.Option
	require.NoError(t, db.First(&option, "key = ?", "ModelRatio").Error)
	var ratios map[string]float64
	require.NoError(t, json.Unmarshal([]byte(option.Value), &ratios))
	require.EqualValues(t, 2, ratios["qwen"])
	require.EqualValues(t, 7, ratios["unrelated"])
	var count int64
	require.NoError(t, db.Model(&model.Ability{}).Where("model = ?", "qwen").Count(&count).Error)
	require.EqualValues(t, 2, count)
	// 本地假上游证明指定渠道测试不会调用另一个同模型来源。
	var firstCalls, secondCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer fixture-a" {
			firstCalls.Add(1)
		} else {
			secondCalls.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"message":"fixture denied","type":"permission_error"}}`))
	}))
	defer upstream.Close()
	previousHTTPClient := client.HTTPClient
	client.HTTPClient = upstream.Client()
	client.HTTPClient.Timeout = 2 * time.Second
	defer func() { client.HTTPClient = previousHTTPClient }()
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", first.Id).Updates(map[string]interface{}{"type": 50, "base_url": upstream.URL, "key": "fixture-a"}).Error)
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", second.Id).Updates(map[string]interface{}{"type": 50, "base_url": upstream.URL, "key": "fixture-b"}).Error)
	tested := call("GET", "/test?model=qwen&channel_id="+strconv.Itoa(first.Id), nil)
	require.Equal(t, true, tested["success"])
	require.Len(t, tested["data"], 1)
	require.EqualValues(t, 1, firstCalls.Load())
	require.Zero(t, secondCalls.Load())
	// 测试请求异步记录日志，等落库后再允许拆除测试数据库。
	require.Eventually(t, func() bool {
		var recorded int64
		return db.Model(&model.Log{}).Where("model_name = ?", "qwen").Count(&recorded).Error == nil && recorded == 1
	}, 3*time.Second, 10*time.Millisecond)
	payload["definition"] = map[string]interface{}{"name": "new-model", "model_type": "chat"}
	require.Equal(t, false, call("POST", "/from_channel", payload)["success"])
	require.Equal(t, true, call("POST", "/definition", map[string]interface{}{"source_channel_id": second.Id, "name": "new-model"})["success"])
	require.Equal(t, false, call("POST", "/definition", map[string]interface{}{"source_channel_id": -1, "name": "invalid-channel"})["success"])
	require.Equal(t, false, call("POST", "/definition", map[string]interface{}{"source_channel_id": 999999, "name": "missing-channel"})["success"])
	require.Equal(t, false, call("POST", "/definition", map[string]interface{}{"source_channel_id": second.Id, "name": "   "})["success"])
	// 未获取模型的渠道可先保存，再手动登记并绑定模型。
	require.Equal(t, true, call("POST", "/channel", map[string]interface{}{"name": "manual-only", "type": 1, "models": "", "group": "default"})["success"])
	var emptyChannel model.Channel
	require.NoError(t, db.Where("name = ?", "manual-only").First(&emptyChannel).Error)
	require.NoError(t, db.Model(&model.Ability{}).Where("channel_id = ?", emptyChannel.Id).Count(&count).Error)
	require.Zero(t, count)
	require.Equal(t, true, call("POST", "/definition", map[string]interface{}{"source_channel_id": emptyChannel.Id, "name": "manual-model"})["success"])
	require.Equal(t, true, call("POST", "/source", map[string]interface{}{"channel_id": emptyChannel.Id, "model": "manual-model", "group": "default"})["success"])
	require.NoError(t, db.Model(&model.Ability{}).Where("channel_id = ? AND model = ?", emptyChannel.Id, "manual-model").Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.Equal(t, false, call("GET", "/test?channel_id=not-a-number&model=qwen", nil)["success"])
	// 倍率写入失败时，定义与来源必须一起回滚，不能出现半保存。
	require.NoError(t, db.Model(&model.Option{}).Where("key = ?", "CompletionRatio").Update("value", "invalid-json").Error)
	payload["channel_id"] = first.Id
	payload["definition"] = map[string]interface{}{"name": "bad-ratio", "model_type": "chat"}
	require.Equal(t, false, call("POST", "/from_channel", payload)["success"])
	require.Error(t, db.Where("name = ?", "bad-ratio").First(&model.ModelDefinition{}).Error)
	require.NoError(t, db.Model(&model.Ability{}).Where("model = ?", "bad-ratio").Count(&count).Error)
	require.Zero(t, count)
}
