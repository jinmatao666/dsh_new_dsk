package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGovernmentMembershipBothEditorsAndAuthorization(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	previous := model.DB
	previousLog := model.LOG_DB
	model.DB = db
	model.LOG_DB = db
	t.Cleanup(func() { model.DB = previous; model.LOG_DB = previousLog })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Role{}, &model.Log{}, &model.GovernmentOrganizationNode{}, &model.GovernmentOrganizationMember{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "member", AffCode: "member-test", AccessToken: "member-token", Role: model.RoleCommonUser, Status: 1}).Error)
	require.NoError(t, db.Create(&model.User{Id: 2, Username: "root", AffCode: "root-test", AccessToken: "root-token", Role: model.RoleRootUser, Status: 1}).Error)
	for _, name := range []string{"规划科", "项目组"} {
		node := model.GovernmentOrganizationNode{Name: name}
		require.NoError(t, model.SaveGovernmentOrganizationNode(&node))
	}
	role := model.RoleRootUser
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(ctxkey.Role, role); c.Set(ctxkey.Id, 2) })
	engine.GET("/members", ListGovernmentMembers)
	engine.PUT("/members", SaveGovernmentMembers)
	call := func(method, body string) map[string]interface{} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(method, "/members", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(w, r)
		var result map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		return result
	}
	require.Equal(t, true, call("PUT", `{"user_id":1,"ids":[1,2]}`)["success"])
	require.Equal(t, true, call("PUT", `{"node_id":1,"ids":[]}`)["success"])
	var saved []model.GovernmentOrganizationMember
	require.NoError(t, db.Find(&saved).Error)
	require.Equal(t, []model.GovernmentOrganizationMember{{UserID: 1, NodeID: 2}}, saved)
	require.Equal(t, false, call("PUT", `{"user_id":1,"ids":[999]}`)["success"])
	require.Equal(t, false, call("PUT", `{"node_id":1,"ids":[999]}`)["success"])
	require.Equal(t, false, call("PUT", `{"user_id":1,"ids":[2,2]}`)["success"])
	require.Equal(t, false, call("PUT", `{"user_id":-1,"node_id":1,"ids":[]}`)["success"])
	require.Equal(t, false, call("PUT", `{"user_id":1}`)["success"])
	require.Error(t, model.DeleteGovernmentOrganizationNode(2))
	directory := call("GET", "")["data"].(map[string]interface{})
	require.Len(t, directory["memberships"], 1)
	require.NotContains(t, directory["users"].([]interface{})[0], "password")
	role = model.RoleAdminUser
	require.Equal(t, false, call("PUT", `{"user_id":2,"ids":[1]}`)["success"])
	require.Equal(t, false, call("PUT", `{"node_id":1,"ids":[1]}`)["success"])
	require.Equal(t, true, call("PUT", `{"user_id":1,"ids":[]}`)["success"])
	require.NoError(t, model.DeleteGovernmentOrganizationNode(2))
	var user model.User
	require.NoError(t, db.First(&user, 1).Error)
	require.Equal(t, model.RoleCommonUser, user.Role)
}
