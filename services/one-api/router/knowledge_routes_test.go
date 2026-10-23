package router

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestKnowledgeAdminRoutesRegister(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)
	found := map[string]bool{}
	for _, route := range engine.Routes() {
		found[route.Method+" "+route.Path] = true
	}
	for _, route := range []string{
		"GET /api/knowledge-admin/bases",
		"POST /api/knowledge-admin/bases",
		"GET /api/knowledge-admin/categories",
		"POST /api/knowledge-admin/categories",
		"GET /api/knowledge-admin/subscription-applications",
		"POST /api/knowledge-admin/subscription-applications/:id/review",
		"GET /api/knowledge-bases/categories",
		"GET /api/knowledge-bases/plaza",
		"GET /api/knowledge-bases/plaza/:id",
		"GET /api/knowledge-bases/plaza/:id/documents",
		"POST /api/knowledge-bases/:id/subscribe",
		"PUT /api/knowledge-admin/bases/:id",
		"DELETE /api/knowledge-admin/bases/:id/documents/:documentId",
		"GET /api/knowledge-bases",
		"GET /api/knowledge-bases/:id/documents",
		"DELETE /api/knowledge-bases/:id/documents/:documentId",
		"POST /api/knowledge-bases/:id/documents/:documentId/copy",
		"POST /api/knowledge-bases/:id/documents/:documentId/move",
		"GET /api/knowledge-bases/:id/documents/:documentId/chunks",
		"GET /api/knowledge-bases/:id/documents/:documentId/file",
		"GET /api/knowledge-bases/:id/chat/messages",
		"POST /api/knowledge-bases/:id/chat/completions",
	} {
		if !found[route] {
			t.Fatalf("missing %s", route)
		}
	}
}
