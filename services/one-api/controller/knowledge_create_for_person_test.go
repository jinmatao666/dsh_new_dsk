package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestKnowledgeCreateForPersonRequiresAdminAndEmptyPersonalCatalog(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "create-person.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous; require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.KnowledgeBase{}, &model.KnowledgeActivity{}))
	require.NoError(t, db.Create(&model.User{Id: 8, Username: "owner", AffCode: "owner", AccessToken: "owner"}).Error)

	deleted := 0
	datasets := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deleted++
			_, _ = w.Write([]byte(`{"code":0,"data":null}`))
			return
		}
		datasets++
		_, _ = fmt.Fprintf(w, `{"code":0,"data":{"id":"created-dataset-%d","name":"个人资料"}}`, datasets)
	}))
	t.Cleanup(upstream.Close)
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")
	call := func(role int, managed bool, owner int) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", 1)
		c.Set("role", role)
		c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(fmt.Sprintf(`{"name":"个人资料","kind":"personal","owner_user_id":%d}`, owner)))
		c.Request.Header.Set("Content-Type", "application/json")
		if managed {
			CreateManagedKnowledgeBase(c)
		} else {
			CreateKnowledgeBase(c)
		}
		return recorder
	}
	require.Equal(t, http.StatusForbidden, call(model.RoleCommonUser, true, 8).Code)
	require.Equal(t, http.StatusForbidden, call(model.RoleAdminUser, false, 8).Code)
	require.Equal(t, http.StatusNotFound, call(model.RoleAdminUser, true, 999).Code)
	created := call(model.RoleAdminUser, true, 8)
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var body struct {
		Data model.KnowledgeBase `json:"data"`
	}
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &body))
	require.Equal(t, 8, body.Data.OwnerUserId)
	require.Equal(t, model.KnowledgeBasePersonal, body.Data.Kind)
	require.Empty(t, body.Data.PublicationScope)
	var activity model.KnowledgeActivity
	require.NoError(t, db.First(&activity).Error)
	require.Equal(t, 1, activity.ActorId)
	require.Equal(t, 8, activity.CreatorId)
	duplicate := call(model.RoleAdminUser, true, 8)
	require.Equal(t, http.StatusConflict, duplicate.Code, duplicate.Body.String())
	require.Equal(t, 1, deleted)
	var count int64
	require.NoError(t, db.Model(&model.KnowledgeBase{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	selfCreated := call(model.RoleCommonUser, false, 0)
	require.Equal(t, http.StatusOK, selfCreated.Code, selfCreated.Body.String())
	require.NoError(t, json.Unmarshal(selfCreated.Body.Bytes(), &body))
	require.Equal(t, 1, body.Data.OwnerUserId)
	require.Empty(t, body.Data.PublicationScope)
	selfCreatedAgain := call(model.RoleCommonUser, false, 0)
	require.Equal(t, http.StatusOK, selfCreatedAgain.Code, selfCreatedAgain.Body.String())
	require.NoError(t, db.Model(&model.KnowledgeBase{}).Where("owner_user_id = ?", 1).Count(&count).Error)
	require.EqualValues(t, 2, count)
}
