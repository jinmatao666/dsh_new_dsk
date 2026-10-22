package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSkillDownloadStatsEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() {
		model.DB = previous
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&model.Skill{}, &model.SkillInstallation{}, &model.SkillUserStat{}, &model.SkillDownloadEvent{}))
	skill := model.Skill{Name: "stats-endpoint", Status: 1}
	require.NoError(t, db.Create(&skill).Error)
	call := func(userID int, body string, handler gin.HandlerFunc) int {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("id", userID)
		c.Params = gin.Params{{Key: "id", Value: "1"}}
		c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		handler(c)
		return w.Code
	}
	const event = `{"event_id":"test-download","version":"1.0.0","user_id":99}`
	require.Equal(t, http.StatusUnauthorized, call(0, event, RecordSkillDownload))
	require.Equal(t, http.StatusUnauthorized, call(0, event, RecordSkillInstallation))
	require.Equal(t, http.StatusBadRequest, call(7, `{}`, RecordSkillDownload))
	require.Equal(t, http.StatusOK, call(7, event, RecordSkillDownload))
	require.Equal(t, http.StatusOK, call(7, event, RecordSkillDownload))
	require.Equal(t, http.StatusBadRequest, call(8, event, RecordSkillInstallation))
	require.Equal(t, http.StatusOK, call(7, event, RecordSkillInstallation))
	require.Equal(t, http.StatusOK, call(7, event, RecordSkillInstallation))
	var row model.SkillUserStat
	require.NoError(t, db.First(&row).Error)
	require.Equal(t, 7, row.UserID)
	require.Equal(t, int64(1), row.DownloadCount)
	require.True(t, row.Installed)
	require.NoError(t, db.Model(&skill).UpdateColumn("status", 0).Error)
	require.Equal(t, http.StatusNotFound, call(7, event, RecordSkillDownload))
}
