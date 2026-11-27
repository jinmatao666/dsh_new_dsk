package controller

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestWebsiteDeploymentInquiryLedger(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old; conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.Feedback{}))
	router := gin.New()
	router.POST("/inquiries", CreateWebsiteDeploymentInquiry)
	router.PUT("/inquiries/:id/read", SetWebsiteDeploymentInquiryRead)
	router.GET("/feedback", GetFeedbackList)
	request := func(method, path, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, r)
		return w
	}
	require.Equal(t, 400, request("POST", "/inquiries", `{"name":"测试","email":"invalid","details":"内网部署"}`).Code)
	require.Equal(t, 201, request("POST", "/inquiries", `{"name":"测试","email":"test@example.com","phone":"13800000000","details":"内网部署"}`).Code)
	require.NoError(t, db.Create(&model.Feedback{FeedbackType: "bug", Content: "普通反馈"}).Error)
	check := func(read bool) {
		r := request("GET", "/feedback?feedback_type=deployment_inquiry", "")
		require.Equal(t, 200, r.Code)
		var response struct {
			Data struct {
				Items []model.Feedback `json:"items"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(r.Body.Bytes(), &response))
		require.Len(t, response.Data.Items, 1)
		row := response.Data.Items[0]
		require.Equal(t, "测试", row.Username)
		require.Equal(t, "test@example.com", row.Context)
		require.Equal(t, "13800000000", row.Phone)
		require.Equal(t, "内网部署", row.Content)
		require.Positive(t, row.CreatedAt)
		require.Equal(t, read, row.Read)
	}
	check(false)
	require.Equal(t, 200, request("PUT", "/inquiries/1/read", `{"read":true}`).Code)
	check(true)
	require.Equal(t, 200, request("PUT", "/inquiries/1/read", `{"read":false}`).Code)
	check(false)
}
