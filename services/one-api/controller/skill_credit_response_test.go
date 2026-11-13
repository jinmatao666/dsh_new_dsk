package controller

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSkillCreditPriceHTTPRoundtrip(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old; conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.Skill{}, &model.SkillRelease{}, &model.SkillCategory{}, &model.SkillCategoryType{}, &model.SkillCategoryRelation{}, &model.SkillInstallation{}))
	skill := model.Skill{Name: "pvs-bidding-doc", Status: 1, Body: "Instructions"}
	require.NoError(t, db.Create(&skill).Error)
	router := gin.New()
	router.PUT("/api/skill/:id", UpdateSkill)
	router.GET("/api/skill/admin/list", AdminListSkills)
	router.GET("/api/skill/", ListSkills)
	for _, price := range []int{3, 12, 0} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("PUT", fmt.Sprintf("/api/skill/%d", skill.Id), strings.NewReader(fmt.Sprintf(`{"task_credits":%d}`, price))))
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"success":true`)
		for _, path := range []string{"/api/skill/admin/list", "/api/skill/"} {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
			require.Equal(t, 200, response.Code)
			var result struct {
				Items []map[string]interface{} `json:"items"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
			require.Len(t, result.Items, 1, response.Body.String())
			require.Equal(t, float64(price), result.Items[0]["task_credits"], path)
		}
	}
}
