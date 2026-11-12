package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestKnowledgeFoldersPersistAndRequirePersonalOwnership(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:knowledge-folders?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}, &model.KnowledgeBaseGrant{}, &model.KnowledgeCategory{}, &model.OrgMember{}, &model.KnowledgeFolder{}))
	rows := []model.KnowledgeBase{
		{Name: "own", Kind: model.KnowledgeBasePersonal, OwnerUserId: 2, RagflowDatasetId: "ds-1", Shelf: model.KnowledgeShelfPublished},
		{Name: "other", Kind: model.KnowledgeBasePersonal, OwnerUserId: 3, RagflowDatasetId: "ds-2", Shelf: model.KnowledgeShelfPublished},
		{Name: "public", Kind: model.KnowledgeBaseCommon, OwnerUserId: 2, RagflowDatasetId: "ds-3", Shelf: model.KnowledgeShelfPublished},
	}
	require.NoError(t, db.Create(&rows).Error)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("id", 2); c.Set("role", model.RoleCommonUser) })
	router.POST("/:id/folders", CreateKnowledgeFolder)
	router.GET("/:id/folders", ListKnowledgeFolders)
	send := func(method string, id int, body string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/"+strconv.Itoa(id)+"/folders", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(r, req)
		return r
	}
	for _, body := range []string{`{}`, `{"name":".."}`, `{"name":"a/../b"}`, `{"name":"a\\b"}`, `{"name":"a\u0000b"}`, `{"name":"` + strings.Repeat("长", 129) + `"}`} {
		require.Equal(t, http.StatusBadRequest, send(http.MethodPost, rows[0].Id, body).Code, body)
	}
	require.Equal(t, http.StatusOK, send(http.MethodPost, rows[0].Id, `{"name":" 新目录 "}`).Code)
	require.Equal(t, http.StatusConflict, send(http.MethodPost, rows[0].Id, `{"name":"新目录"}`).Code)
	require.Equal(t, http.StatusOK, send(http.MethodPost, rows[0].Id, `{"name":"新目录/子目录"}`).Code)
	list := send(http.MethodGet, rows[0].Id, "")
	require.Equal(t, http.StatusOK, list.Code)
	require.Contains(t, list.Body.String(), "新目录")
	require.Equal(t, http.StatusForbidden, send(http.MethodPost, rows[1].Id, `{"name":"folder"}`).Code)
	require.Equal(t, http.StatusForbidden, send(http.MethodPost, rows[2].Id, `{"name":"folder"}`).Code)
}
