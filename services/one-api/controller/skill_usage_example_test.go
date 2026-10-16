package controller

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSkillUsageExampleResponse(t *testing.T) {
	encoded, err := json.Marshal(skillToResponse(model.Skill{UsageExample: "第一条示例\n第二条示例"}))
	if err != nil || !strings.Contains(string(encoded), `"usage_example":"第一条示例\n第二条示例"`) {
		t.Fatalf("usage example missing from response: %s, %v", encoded, err)
	}
}

func TestSkillUsageExamplePersistence(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite persistence test requires CGO")
		}
		t.Fatal(err)
	}
	previous := model.DB
	model.DB = db
	sqlDB, _ := db.DB()
	t.Cleanup(func() { model.DB = previous; _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillRelease{}, &model.SkillCategory{}, &model.SkillCategoryType{}, &model.SkillCategoryRelation{}); err != nil {
		t.Fatal(err)
	}
	skill := model.Skill{Name: "usage-example", Status: 1, Body: "Skill instructions"}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/:id", UpdateSkill)
	for _, example := range []string{"请清理 Excel 中的重复行。\n不要修改原文件。", ""} {
		body, _ := json.Marshal(map[string]string{"usage_example": example})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("PUT", "/"+strconv.Itoa(skill.Id), strings.NewReader(string(body))))
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"success":true`) {
			t.Fatalf("update failed: %s", response.Body.String())
		}
		var stored model.Skill
		if err := db.First(&stored, skill.Id).Error; err != nil {
			t.Fatal(err)
		}
		if stored.UsageExample != example || stored.Body != "Skill instructions" {
			t.Fatalf("incorrect saved skill: %#v", stored)
		}
		items, _, err := model.SearchSkillsWithOptions("usage-example", model.SkillCategoryFilter{}, 1, 10, true, model.SkillDeletedNormal, "updated_at", "desc")
		if err != nil || len(items) != 1 || items[0].UsageExample != example {
			t.Fatalf("list omitted example: %#v, %v", items, err)
		}
	}
	for _, value := range []string{"123", "null", "[]"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("PUT", "/"+strconv.Itoa(skill.Id), strings.NewReader(`{"usage_example":`+value+`}`)))
		if response.Code != 400 {
			t.Fatalf("invalid example accepted: %s", response.Body.String())
		}
	}
}
