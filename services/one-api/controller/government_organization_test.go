package controller

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGovernmentOrganizationTreeAndRoleReferences(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil && strings.Contains(err.Error(), "CGO_ENABLED=0") {
		t.Skip("requires SQLite CGO")
	}
	require.NoError(t, err)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Role{}, &model.GovernmentOrganizationNode{}))
	require.NoError(t, model.SeedBuiltinRoles())
	actor := model.RoleRootUser
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(ctxkey.Role, actor) })
	engine.GET("/organization", ListGovernmentOrganizationNodes)
	engine.POST("/organization", CreateGovernmentOrganizationNode)
	engine.PUT("/organization/:id", UpdateGovernmentOrganizationNode)
	engine.DELETE("/organization/:id", DeleteGovernmentOrganizationNode)
	engine.POST("/role", CreateRole)
	call := func(method, path, body string) map[string]interface{} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(w, r)
		var response map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		return response
	}
	root := call("POST", "/organization", `{"name":"浙政钉","kind":"平台"}`)
	require.Equal(t, true, root["success"])
	rootID := uint(root["data"].(map[string]interface{})["id"].(float64))
	child := call("POST", "/organization", `{"parent_id":1,"name":"杭州市","kind":"地（市）"}`)
	require.Equal(t, true, child["success"])
	childID := uint(child["data"].(map[string]interface{})["id"].(float64))
	require.NotEqual(t, rootID, childID)
	require.Equal(t, false, call("PUT", "/organization/1", `{"parent_id":2,"name":"浙政钉"}`)["success"])
	require.Equal(t, false, call("POST", "/organization", `{"parent_id":999,"name":"孤儿"}`)["success"])
	require.Equal(t, false, call("DELETE", "/organization/1", "")["success"])
	require.Equal(t, true, call("POST", "/role", `{"role_type":"member","name":"规划人员","permissions":{"organization_node_ids":[2]}}`)["success"])
	require.Equal(t, false, call("DELETE", "/organization/2", "")["success"])
	require.Equal(t, false, call("POST", "/role", `{"role_type":"member","name":"不存在的组织","permissions":{"organization_node_ids":[999]}}`)["success"])
	require.Len(t, call("GET", "/organization", "")["data"].([]interface{}), 2)
	actor = model.RoleAdminUser
	require.Equal(t, false, call("POST", "/organization", `{"name":"越权"}`)["success"])
	require.Equal(t, true, call("GET", "/organization", "")["success"])
}
