package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestRequireRemoteSkills(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("disabled", func(t *testing.T) {
		t.Setenv("PARVIS_CAPABILITIES", "ocr")
		called := false
		router := gin.New()
		router.Use(RequireRemoteSkills())
		router.GET("/skill", func(c *gin.Context) {
			called = true
			c.Status(http.StatusNoContent)
		})

		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/skill", nil))

		assert.Equal(t, http.StatusForbidden, response.Code)
		assert.False(t, called)
		assert.Contains(t, response.Body.String(), `"success":false`)
	})

	t.Run("enabled", func(t *testing.T) {
		t.Setenv("PARVIS_CAPABILITIES", "remote_skills")
		called := false
		router := gin.New()
		router.Use(RequireRemoteSkills())
		router.GET("/skill", func(c *gin.Context) {
			called = true
			c.Status(http.StatusNoContent)
		})

		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/skill", nil))

		assert.Equal(t, http.StatusNoContent, response.Code)
		assert.True(t, called)
	})
}
