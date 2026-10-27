package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUserProfileScopesObservedEventsToSelectedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() { model.DB, model.LOG_DB = previousDB, previousLogDB; _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.UsageEvent{}, &model.Skill{}, &model.SkillUserStat{}))
	require.NoError(t, db.Create(&model.User{Id: 7, Username: "alice", AccessToken: "alice-token", AffCode: "alice"}).Error)
	require.NoError(t, db.Create(&model.User{Id: 8, Username: "bob", AccessToken: "bob-token", AffCode: "bob"}).Error)
	now := time.Now()
	today := now.In(time.FixedZone("CST", 8*60*60)).Format("2006-01-02")
	require.NoError(t, db.Create(&model.Log{UserId: 7, Type: model.LogTypeConsume, CreatedAt: now.Unix(), ModelName: "qwen", PromptTokens: 12, CompletionTokens: 4}).Error)
	require.NoError(t, db.Create(&model.Log{UserId: 7, Type: model.LogTypeConsume, CreatedAt: now.AddDate(0, 0, -31).Unix(), ModelName: "old"}).Error)
	require.NoError(t, db.Create(&model.Log{UserId: 8, Type: model.LogTypeConsume, CreatedAt: now.Unix(), ModelName: "other"}).Error)
	require.NoError(t, db.Create(&model.UsageEvent{EventID: "skill-event-1", Kind: "skill", UserID: 7, ItemID: "report", ItemName: "报告技能", Day: today}).Error)
	require.NoError(t, db.Create(&model.UsageEvent{EventID: "expert-event-1", Kind: "expert", UserID: 7, ItemID: "expert", ItemName: "文档专家", Day: today}).Error)
	require.NoError(t, db.Create(&model.UsageEvent{EventID: "skill-event-2", Kind: "skill", UserID: 8, ItemID: "other", ItemName: "其他", Day: today}).Error)
	require.NoError(t, db.Create(&model.UsageEvent{EventID: "skill-event-old", Kind: "skill", UserID: 7, ItemID: "old", ItemName: "旧记录", Day: now.AddDate(0, 0, -31).In(time.FixedZone("CST", 8*60*60)).Format("2006-01-02")}).Error)
	require.NoError(t, db.Create(&model.SkillUserStat{UserID: 7, SkillID: 99, DownloadCount: 2, Installed: true}).Error)
	call := func(id string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Params = gin.Params{{Key: "id", Value: id}}
		c.Request = httptest.NewRequest(http.MethodGet, "/api/user/"+id+"/profile", nil)
		GetUserProfile(c)
		return w
	}
	require.Equal(t, http.StatusBadRequest, call("bad").Code)
	require.Equal(t, http.StatusNotFound, call("999").Code)
	response := call("7")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Models struct {
				Count        int64         `json:"count"`
				PromptTokens int64         `json:"prompt_tokens"`
				Days         []profileDay  `json:"days"`
				Top          []profileRank `json:"top"`
			} `json:"models"`
			Skills    profileUsage     `json:"skills"`
			Experts   profileUsage     `json:"experts"`
			Downloads profileDownloads `json:"downloads"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Success)
	require.Equal(t, int64(1), result.Data.Models.Count)
	require.Equal(t, int64(12), result.Data.Models.PromptTokens)
	require.Equal(t, "qwen", result.Data.Models.Top[0].Name)
	require.Equal(t, today, result.Data.Models.Days[0].Day)
	require.Equal(t, int64(1), result.Data.Skills.Count)
	require.Equal(t, int64(1), result.Data.Experts.Count)
	require.Equal(t, int64(2), result.Data.Downloads.Count)
	require.Equal(t, int64(1), result.Data.Downloads.InstalledCount)
}
