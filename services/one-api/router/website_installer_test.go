package router

import (
	"github.com/gin-gonic/gin"
	"testing"
)

func TestWebsiteInstallerRoutes(t *testing.T) {
	r := gin.New()
	SetApiRouter(r)
	found := map[string]bool{}
	for _, route := range r.Routes() {
		found[route.Method+" "+route.Path] = true
	}
	for _, path := range []string{"GET /api/website-installers", "GET /downloads/installers/:id", "HEAD /downloads/installers/:id", "GET /api/admin/website-installers", "POST /api/admin/website-installers", "POST /api/admin/website-installers/:id/:action", "DELETE /api/admin/website-installers/:id"} {
		if !found[path] {
			t.Fatalf("missing %s", path)
		}
	}
}
