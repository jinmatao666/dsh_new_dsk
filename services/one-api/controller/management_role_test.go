package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

func TestManagementActorRoleElevatesOrdinaryUsers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		actor int
		want  int
	}{
		{model.RoleCommonUser, model.RoleAdminUser},
		{model.RoleAdminUser, model.RoleAdminUser},
		{model.RoleRootUser, model.RoleRootUser},
		{0, 0},
	}
	for _, tc := range cases {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set(ctxkey.Role, tc.actor)
		if got := managementActorRole(c); got != tc.want {
			t.Fatalf("actor=%d: got %d want %d", tc.actor, got, tc.want)
		}
	}
}
