package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStatusIncludesDeploymentContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("PARVIS_DEPLOYMENT_MODE", "private")
	t.Setenv("PARVIS_CAPABILITIES", "remote_mcp,ocr")

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			DeploymentMode      string          `json:"deployment_mode"`
			ConfigSchemaVersion int             `json:"config_schema_version"`
			Capabilities        map[string]bool `json:"capabilities"`
			Version             string          `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, "private", response.Data.DeploymentMode)
	assert.Equal(t, 1, response.Data.ConfigSchemaVersion)
	assert.True(t, response.Data.Capabilities["remote_mcp"])
	assert.True(t, response.Data.Capabilities["ocr"])
	assert.False(t, response.Data.Capabilities["web_search"])
	assert.NotEmpty(t, response.Data.Version)
}
