package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func corsPreflight(origin string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CORS())
	router.GET("/status", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	request := httptest.NewRequest(http.MethodOptions, "/status", nil)
	request.Header.Set("Origin", origin)
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestPrivateCORSDefaultsToDesktopOrigins(t *testing.T) {
	t.Setenv("PARVIS_DEPLOYMENT_MODE", "private")
	t.Setenv("CORS_ALLOW_ORIGINS", "")

	allowed := corsPreflight("http://tauri.localhost")
	assert.Equal(t, http.StatusNoContent, allowed.Code)
	assert.Equal(t, "http://tauri.localhost", allowed.Header().Get("Access-Control-Allow-Origin"))

	denied := corsPreflight("https://untrusted.example")
	assert.Equal(t, http.StatusForbidden, denied.Code)
	assert.Empty(t, denied.Header().Get("Access-Control-Allow-Origin"))
}

func TestPrivateCORSUsesExplicitAllowlist(t *testing.T) {
	t.Setenv("PARVIS_DEPLOYMENT_MODE", "private")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://parvis.internal.example")

	allowed := corsPreflight("https://parvis.internal.example")
	assert.Equal(t, http.StatusNoContent, allowed.Code)
	assert.Equal(t, "https://parvis.internal.example", allowed.Header().Get("Access-Control-Allow-Origin"))
}

func TestPublicCORSPreservesLegacyDefault(t *testing.T) {
	t.Setenv("PARVIS_DEPLOYMENT_MODE", "public")
	t.Setenv("CORS_ALLOW_ORIGINS", "")

	response := corsPreflight("https://public-client.example")
	assert.Equal(t, http.StatusNoContent, response.Code)
	assert.Equal(t, "https://public-client.example", response.Header().Get("Access-Control-Allow-Origin"))
}
