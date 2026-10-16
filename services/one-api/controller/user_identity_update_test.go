package controller

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/snowflake"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestUserIdentityUpdateAdminAndSelfPersist(t *testing.T) {
	require.NoError(t, snowflake.Init(0))
	var driver gorm.Dialector = sqlite.Open(":memory:")
	schema := ""
	if dsn := os.Getenv("DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN"); dsn != "" {
		schema = "identity_controller_" + strconv.FormatInt(time.Now().UnixNano(), 10)
		driver = postgres.Open(dsn + " search_path=" + schema)
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	if err != nil && strings.Contains(err.Error(), "CGO_ENABLED=0") {
		t.Skip("requires SQLite CGO or PostgreSQL test DSN")
	}
	require.NoError(t, err)
	if schema != "" {
		require.NoError(t, db.Exec("CREATE SCHEMA "+schema).Error)
	}
	previous, previousAccount := model.DB, model.ACCOUNT_DB
	model.DB, model.ACCOUNT_DB = db, db
	t.Cleanup(func() {
		model.DB, model.ACCOUNT_DB = previous, previousAccount
		if schema != "" {
			db.Exec("DROP SCHEMA " + schema + " CASCADE")
		}
		sqlDB, _ := db.DB()
		sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Role{}, &model.Account{}, &model.AccountProduct{}, &model.AccountProfile{}, &model.AccountIdentifier{}, &model.AccountCredential{}))
	require.NoError(t, db.Create(&model.Role{Role: 1, Name: "member", Status: 1, Permissions: json.RawMessage(`{}`)}).Error)
	admin := model.User{Username: "admin_test", Status: 1, Role: 100, AccessToken: "admin_token", AffCode: "admin_aff"}
	user := model.User{Username: "user_test", Status: 1, Role: 1, AccessToken: "user_token", AffCode: "user_aff"}
	for _, u := range []*model.User{&admin, &user} {
		require.NoError(t, db.Create(u).Error)
		_, err := model.EnsureAccountForUser(u)
		require.NoError(t, err)
	}
	require.NoError(t, model.WriteAccountCredentialByLocalUser(admin.Id, "AdminPass123"))
	call := func(handler gin.HandlerFunc, id, role int, payload map[string]interface{}) map[string]interface{} {
		body, err := json.Marshal(payload)
		require.NoError(t, err)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("PUT", "/api/user/", strings.NewReader(string(body)))
		c.Set(ctxkey.Id, id)
		c.Set(ctxkey.Role, role)
		handler(c)
		var response map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		return response
	}
	payload := map[string]interface{}{"id": user.Id, "username": "admin_new", "role": 1, "display_name": "管理员修改", "admin_password": "wrong"}
	require.Equal(t, false, call(UpdateUser, admin.Id, 100, payload)["success"])
	payload["admin_password"] = "AdminPass123"
	require.Equal(t, true, call(UpdateUser, admin.Id, 100, payload)["success"])
	loaded, err := model.GetUserById(user.Id, false)
	require.NoError(t, err)
	require.Equal(t, "admin_new", loaded.Username)
	require.Equal(t, "管理员修改", loaded.DisplayName)
	self := map[string]interface{}{"username": "self_new", "display_name": "自行修改", "password": "UserPass123"}
	require.Equal(t, true, call(UpdateSelf, user.Id, 1, self)["success"])
	login := model.User{Username: "self_new", Password: "UserPass123"}
	require.NoError(t, login.ValidateAndFill())
	require.NoError(t, db.Migrator().DropTable(&model.AccountProfile{}))
	self = map[string]interface{}{"username": "self_new", "display_name": "写入失败"}
	require.Equal(t, false, call(UpdateSelf, user.Id, 1, self)["success"])
}
