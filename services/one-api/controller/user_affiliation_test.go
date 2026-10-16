package controller

import (
	"encoding/json"
	"fmt"
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

func TestAdminUserAffiliationUpdateAndList(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Role{}))
	savedDB, savedAccountDB := model.DB, model.ACCOUNT_DB
	model.DB, model.ACCOUNT_DB = db, nil
	t.Cleanup(func() { model.DB, model.ACCOUNT_DB = savedDB, savedAccountDB })
	require.NoError(t, db.Create(&model.Role{Role: 1, Name: "用户", Status: 1, Permissions: json.RawMessage(`{}`)}).Error)
	user := model.User{Username: "tester", Role: 1, Group: "custom", UnitName: "单位甲", DepartmentName: "部门甲"}
	require.NoError(t, db.Create(&user).Error)
	for _, extra := range []string{`,"unit_name":"单位乙","department_name":"部门乙"`, ``, `,"department_name":""`} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("PUT", "/api/user/", strings.NewReader(fmt.Sprintf(`{"id":%d,"username":"tester","group":"custom"%s}`, user.Id, extra)))
		c.Set(ctxkey.Role, model.RoleRootUser)
		UpdateUser(c)
		var response struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.True(t, response.Success, response.Message)
		var stored model.User
		require.NoError(t, db.First(&stored, user.Id).Error)
		require.Equal(t, "单位乙", stored.UnitName)
		if extra == `,"department_name":""` {
			require.Empty(t, stored.DepartmentName)
		} else {
			require.Equal(t, "部门乙", stored.DepartmentName)
		}
		require.Equal(t, "custom", stored.Group)
		require.Equal(t, model.AccountTypePersonal, stored.AccountType)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/user/?p=0", nil)
	GetAllUsers(c)
	require.Contains(t, w.Body.String(), `"unit_name":"单位乙"`)
	require.Contains(t, w.Body.String(), `"department_name":""`)
}
