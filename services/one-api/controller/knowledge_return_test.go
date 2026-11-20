package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestKnowledgeReturnUsesUploaderAndRejectsOtherOwners(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "return.db")), &gorm.Config{})
	require.NoError(t, err)
	previous, sqliteMode := model.DB, common.UsingSQLite
	config.OptionMapRWMutex.Lock()
	options := config.OptionMap
	config.OptionMap = map[string]string{}
	config.OptionMapRWMutex.Unlock()
	model.DB, common.UsingSQLite = db, true
	t.Cleanup(func() {
		model.DB, common.UsingSQLite = previous, sqliteMode
		config.OptionMapRWMutex.Lock()
		config.OptionMap = options
		config.OptionMapRWMutex.Unlock()
		sql, _ := db.DB()
		sql.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}, &model.User{}, &model.KnowledgeDocumentCreator{}, &model.KnowledgeDocumentNote{}, &model.KnowledgeDocumentPath{}, &model.KnowledgeDocumentCover{}, &model.KnowledgeActivity{}))
	require.NoError(t, db.Create(&model.User{Id: 2, Username: "uploader", DisplayName: "小李", AffCode: "uploader", AccessToken: "uploader"}).Error)
	source := model.KnowledgeBase{Name: "public", Kind: model.KnowledgeBaseCommon, OwnerUserId: 1, RagflowDatasetId: "source"}
	target := model.KnowledgeBase{Name: "private", Kind: model.KnowledgeBasePersonal, OwnerUserId: 2, RagflowDatasetId: "target"}
	other := model.KnowledgeBase{Name: "other", Kind: model.KnowledgeBasePersonal, OwnerUserId: 3, RagflowDatasetId: "other"}
	published := model.KnowledgeBase{Name: "published", Kind: model.KnowledgeBasePersonal, OwnerUserId: 2, RagflowDatasetId: "published", PublicationScope: "public"}
	for _, row := range []*model.KnowledgeBase{&source, &target, &other, &published} {
		require.NoError(t, db.Create(row).Error)
	}
	require.NoError(t, model.SaveKnowledgeDocumentCreator(source.Id, "file", 2))
	var deletes atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/source/documents/file"):
			w.Header().Set("Content-Type", "application/octet-stream")
			fmt.Fprint(w, "file bytes")
		case strings.HasSuffix(r.URL.Path, "/source/documents") && r.Method == "GET":
			fmt.Fprint(w, `{"code":0,"data":{"docs":[{"id":"file","name":"file.txt","size":10}],"total":1}}`)
		case strings.HasSuffix(r.URL.Path, "/target/documents") && r.Method == "GET":
			fmt.Fprint(w, `{"code":0,"data":{"docs":[],"total":0}}`)
		case strings.HasSuffix(r.URL.Path, "/target/documents") && r.Method == "POST":
			fmt.Fprint(w, `{"code":0,"data":[{"id":"returned","name":"file.txt"}]}`)
		default:
			if strings.HasSuffix(r.URL.Path, "/source/documents") && r.Method == "DELETE" {
				deletes.Add(1)
			}
			fmt.Fprint(w, `{"code":0,"data":null}`)
		}
	}))
	defer upstream.Close()
	t.Setenv("RAGFLOW_BASE_URL", upstream.URL)
	t.Setenv("RAGFLOW_API_KEY", "test")
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("id", 1); c.Set("role", model.RoleRootUser) })
	router.GET("/:id/documents", ListManagedKnowledgeDocuments)
	router.GET("/:id/documents/:documentId/return-targets", ListKnowledgeReturnTargets)
	router.POST("/:id/documents/:documentId/return-personal", ReturnManagedKnowledgeDocument)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, fmt.Sprintf("/%d/documents%s", source.Id, path), strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	list := call("GET", "", "")
	require.Equal(t, 200, list.Code, list.Body.String())
	require.Contains(t, list.Body.String(), `"creator_name":"小李"`)
	targets := call("GET", "/file/return-targets", "")
	require.Equal(t, 200, targets.Code, targets.Body.String())
	require.Contains(t, targets.Body.String(), `"name":"private"`)
	require.NotContains(t, targets.Body.String(), `"name":"other"`)
	require.NotContains(t, targets.Body.String(), `"name":"published"`)
	for _, id := range []int{other.Id, published.Id} {
		r := call("POST", "/file/return-personal", fmt.Sprintf(`{"target_knowledge_base_id":%d}`, id))
		require.Equal(t, 403, r.Code, r.Body.String())
	}
	unknown := call("GET", "/unknown/return-targets", "")
	require.Equal(t, 400, unknown.Code)
	r := call("POST", "/file/return-personal", fmt.Sprintf(`{"target_knowledge_base_id":%d}`, target.Id))
	require.Equal(t, 200, r.Code, r.Body.String())
	require.Equal(t, int32(1), deletes.Load())
	creators, err := model.ListKnowledgeDocumentCreators(target.Id)
	require.NoError(t, err)
	require.Equal(t, 2, creators["returned"])
}
