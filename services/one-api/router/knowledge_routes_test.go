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
