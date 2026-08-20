package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/model"
)

// bundle 只在 :memory: SQLite 内测,隔离本地/生产库.
func setupSkillBundleTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Skill{}))
	model.DB = db
}

// 用 gin httptest 直打 GetSkillBundle,断言：正文不下发(body 恒为空)、
// assets 完整下发、被禁用/软删技能一律 not found。
func doGetBundle(t *testing.T, id string) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/skill/"+id+"/bundle", nil)
	c.Params = gin.Params{{Key: "id", Value: id}}
	GetSkillBundle(c)

	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	return w.Code, body
}

func TestGetSkillBundle_stripsBodyReturnsAssets(t *testing.T) {
	setupSkillBundleTestDB(t)

	normal := &model.Skill{
		Name:      "normal",
		Content:   "legacy",
		Body:      "工作手册正文",
		Assets:    "<!-- file: a.py -->\n```python\nprint(1)\n```",
		Status:    1,
		IsDeleted: false,
	}
	require.NoError(t, model.CreateSkill(normal))

	code, body := doGetBundle(t, itoa(normal.Id))
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, true, body["success"])

	data := body["data"].(map[string]any)
	// 关键断言：正文不下发。
	assert.Equal(t, "", data["body"], "bundle 不应返回 body 正文")
	// assets 仍完整下发(客户端安装依赖它)。
	assert.NotEmpty(t, data["assets"], "bundle 应返回 assets")
}

func TestGetSkillBundle_disabledOrDeletedNotFound(t *testing.T) {
	setupSkillBundleTestDB(t)

	// status=0(已禁用),用 UPDATE 落库避开 gorm default:1 对零值的覆盖。
	disabled := &model.Skill{Name: "disabled", Content: "x", Status: 1, IsDeleted: false}
	require.NoError(t, model.CreateSkill(disabled))
	require.NoError(t, model.DB.Model(disabled).Update("status", 0).Error)

	deleted := &model.Skill{Name: "deleted", Content: "x", Status: 1, IsDeleted: true}
	require.NoError(t, model.CreateSkill(deleted))

	for _, id := range []int{disabled.Id, deleted.Id, 999999} {
		code, body := doGetBundle(t, itoa(id))
		assert.Equal(t, http.StatusOK, code)
		assert.Equal(t, false, body["success"], "id=%d 应 not found", id)
	}
}

func itoa(i int) string {
	return strconv.Itoa(i)
}
