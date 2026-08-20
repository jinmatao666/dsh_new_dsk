package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMCPInternalAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PARVIS_MCP_INTERNAL_KEY", "internal-secret")
	router := gin.New()
	router.GET("/validate", MCPInternalAuth(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	bad := httptest.NewRecorder()
	badRequest := httptest.NewRequest(http.MethodGet, "/validate", nil)
	badRequest.Header.Set("X-Parvis-Internal-Key", "wrong")
	router.ServeHTTP(bad, badRequest)
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", bad.Code)
	}

	ok := httptest.NewRecorder()
	okRequest := httptest.NewRequest(http.MethodGet, "/validate", nil)
	okRequest.Header.Set("X-Parvis-Internal-Key", "internal-secret")
	router.ServeHTTP(ok, okRequest)
	if ok.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", ok.Code)
	}
}
