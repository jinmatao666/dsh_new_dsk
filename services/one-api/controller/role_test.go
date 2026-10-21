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
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestManagedRoleLifecycle(t *testing.T) {
	var driver gorm.Dialector = sqlite.Open(":memory:")
	schema := ""
	if dsn := os.Getenv("DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN"); dsn != "" {
		schema = "role_lifecycle_" + strconv.FormatInt(time.Now().UnixNano(), 10)
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
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previous := model.DB
	model.DB = db
	t.Cleanup(func() {
		model.DB = previous
		if schema != "" {
			db.Exec("DROP SCHEMA " + schema + " CASCADE")
		}
		sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Role{}))
	require.NoError(t, model.SeedBuiltinRoles())
	// 历史账号引用但尚未建档的编号，也必须避开。
	require.NoError(t, db.Create(&model.User{Username: "legacy", Role: 2}).Error)
	engine := gin.New()
	actor := 100
	engine.Use(func(c *gin.Context) { c.Set(ctxkey.Role, actor) })
	engine.POST("/role", CreateRole)
	engine.DELETE("/role/:role", DeleteRole)
	call := func(method, path, body string) map[string]interface{} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(w, r)
		var response map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		return response
	}
	member := call("POST", "/role", `{"role_type":"member","name":"审核员","role":100}`)
	require.Equal(t, true, member["success"])
	require.Equal(t, float64(3), member["data"].(map[string]interface{})["role"])
	admin := call("POST", "/role", `{"role_type":"admin","name":"业务管理员"}`)
	require.Equal(t, true, admin["success"])
	require.Equal(t, float64(10), admin["data"].(map[string]interface{})["role"])
	require.Equal(t, false, call("POST", "/role", `{"role_type":"root","name":"伪造"}`)["success"])
	duplicate := call("POST", "/role", `{"role_type":"member","name":"审核员"}`)
	require.Equal(t, false, duplicate["success"])
	require.Contains(t, duplicate["message"], "名称已存在")
	actor = 10
	require.Equal(t, false, call("POST", "/role", `{"role_type":"admin","name":"越权"}`)["success"])
	require.Equal(t, false, call("DELETE", "/role/10", "")["success"])
	actor = 100
	for _, path := range []string{"/role/1", "/role/100", "/role/999"} {
		require.Equal(t, false, call("DELETE", path, "")["success"])
	}
	require.NoError(t, db.Model(&model.User{}).Where("username = ?", "legacy").Update("role", 3).Error)
	require.Equal(t, false, call("DELETE", "/role/3", "")["success"])
	require.NoError(t, db.Model(&model.User{}).Where("username = ?", "legacy").Update("role", 1).Error)
	require.Equal(t, true, call("DELETE", "/role/3", "")["success"])
	require.Equal(t, false, call("DELETE", "/role/3", "")["success"])
	for code := 2; code < 10; code++ {
		require.NoError(t, db.Create(&model.Role{Role: code, Name: string(rune('A' + code)), Permissions: json.RawMessage(`{}`)}).Error)
	}
	require.Equal(t, false, call("POST", "/role", `{"role_type":"member","name":"区间用尽"}`)["success"])
	var count int64
	require.NoError(t, db.Model(&model.Role{}).Where("role = 100").Count(&count).Error)
	require.EqualValues(t, 1, count)
}
