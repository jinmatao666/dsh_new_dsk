package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestKnowledgePDFCoverPersistsAndServesOnlyToAuthorizedReaders(t *testing.T) {
	renderer, err := exec.LookPath("pdftoppm")
	if err != nil {
		t.Skip("pdftoppm unavailable")
	}
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "cover.db")), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { model.DB = previous; require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.KnowledgeBase{}, &model.KnowledgeCategory{}, &model.KnowledgeBaseGrant{},
		&model.OrgMember{}, &model.GovernmentOrganizationMember{}, &model.KnowledgeDocumentCover{}))
	base := model.KnowledgeBase{Name: "Private library", Kind: model.KnowledgeBasePersonal, OwnerUserId: 7, RagflowDatasetId: "cover-test"}
	require.NoError(t, db.Create(&base).Error)
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/datasets/cover-test/documents/pdf" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write(testCoverPDF())
	}))
	defer source.Close()
	t.Setenv("RAGFLOW_BASE_URL", source.URL)
	t.Setenv("RAGFLOW_API_KEY", "test-key")
	queueKnowledgePDFCover(context.Background(), base.Id, "other.txt", []ragflow.Document{{Id: "txt"}})
	queueKnowledgePDFCover(context.Background(), base.Id, "example.PDF", []ragflow.Document{{Id: "pdf"}})
	states, err := model.ListKnowledgeDocumentCoverStates(base.Id)
	require.NoError(t, err)
	require.Equal(t, map[string]string{"pdf": "pending"}, states)
	job, err := model.ClaimKnowledgeDocumentCover(context.Background(), time.Now(), time.Minute)
	require.NoError(t, err)
	require.NotNil(t, job)
	next, err := model.ClaimKnowledgeDocumentCover(context.Background(), time.Now(), time.Minute)
	require.NoError(t, err)
	require.Nil(t, next)
	runKnowledgeCoverJob(context.Background(), renderer, job)
	source.Close()

	get := func(userId int) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
		c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(base.Id)}, {Key: "documentId", Value: "pdf"}}
		c.Set("id", userId)
		GetKnowledgeDocumentCover(c)
		return w
	}
	owner := get(7)
	require.Equal(t, http.StatusOK, owner.Code, owner.Body.String())
	var response struct{ Data []byte }
	require.NoError(t, json.Unmarshal(owner.Body.Bytes(), &response))
	require.True(t, strings.HasPrefix(string(response.Data), "\xff\xd8\xff"))
	require.Equal(t, http.StatusForbidden, get(8).Code)
	require.NoError(t, model.DeleteKnowledgeDocumentCovers(base.Id, []string{"pdf"}))
	require.Equal(t, http.StatusNotFound, get(7).Code)
}

func testCoverPDF() []byte {
	var pdf strings.Builder
	pdf.WriteString("%PDF-1.4\n")
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>",
	}
	offsets := make([]int, len(objects))
	for i, object := range objects {
		offsets[i] = pdf.Len()
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	start := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, start)
	return []byte(pdf.String())
}
