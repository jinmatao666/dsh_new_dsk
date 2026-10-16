package controller

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSkillImportPersistsOfflineStatusAndRejectsDuplicateWithoutUnpublishing(t *testing.T) {
	var driver gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "imports.db"))
	schema := ""
	if dsn := os.Getenv("DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN"); dsn != "" {
		schema = "skill_import_test_" + strconv.FormatInt(time.Now().UnixNano(), 10)
		driver = postgres.Open(dsn + " search_path=" + schema)
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	if err != nil {
		if schema == "" && strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO; set DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN for isolated PostgreSQL verification")
		}
		t.Fatal(err)
	}
	if schema != "" {
		if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
	}
	previous := model.DB
	model.DB = db
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if schema != "" {
			db.Exec("DROP SCHEMA " + schema + " CASCADE")
		}
		model.DB = previous
		sqlDB.Close()
	})
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillRelease{}, &model.SkillCategoryType{}, &model.SkillCategory{}, &model.SkillCategoryRelation{}); err != nil {
		t.Fatal(err)
	}
	categoryType := model.SkillCategoryType{Code: model.SkillCategoryTypePackage, Name: "技能包", Status: 1}
	if err := db.Create(&categoryType).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillCategory{TypeId: categoryType.Id, Code: "general", Name: model.DefaultSkillCategoryName, Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/import", ImportSkillRelease)
	upload := func(version string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("package", "example.zip")
		if err != nil {
			t.Fatal(err)
		}
		archive := skillArchiveForTest(t, map[string]string{
			"SKILL.md":      "---\nname: imported-status\ndescription: Example\n---\n# Example\n",
			"manifest.json": `{"name":"imported-status","version":"` + version + `"}`,
		})
		if _, err := part.Write(archive); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("POST", "/import", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	response := upload("1.0.0")
	if response.Code != 200 {
		t.Fatalf("import: %s", response.Body.String())
	}
	var payload struct {
		Data struct {
			Skill model.Skill `json:"skill"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Data.Skill.Status != 0 {
		t.Fatalf("response status: %d", payload.Data.Skill.Status)
	}
	var skill model.Skill
	if err := db.First(&skill, payload.Data.Skill.Id).Error; err != nil {
		t.Fatal(err)
	}
	if skill.Status != 0 {
		t.Fatalf("stored status: %d", skill.Status)
	}

	var oldRelease model.SkillRelease
	if err := db.Where("skill_id = ?", skill.Id).First(&oldRelease).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&oldRelease).Update("state", model.SkillReleasePublished).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&skill).Updates(map[string]interface{}{"status": 1, "published_release_id": oldRelease.Id}).Error; err != nil {
		t.Fatal(err)
	}
	if err := model.RefreshSkillCache(); err != nil {
		t.Fatal(err)
	}
	if response := upload("1.0.0"); response.Code != 409 {
		t.Fatalf("duplicate: %s", response.Body.String())
	}
	if err := db.First(&skill, skill.Id).Error; err != nil {
		t.Fatal(err)
	}
	if skill.Status != 1 {
		t.Fatal("rejected import changed the published status")
	}
	if response := upload("1.1.0"); response.Code != 200 {
		t.Fatalf("new version: %s", response.Body.String())
	}
	skill = model.Skill{Id: skill.Id}
	if err := db.First(&skill, skill.Id).Error; err != nil {
		t.Fatal(err)
	}
	if skill.Status != 0 || skill.PublishedReleaseId != nil {
		t.Fatalf("new version did not unpublish: %#v", skill)
	}
	if model.GetSkillByName("imported-status") != nil {
		t.Fatal("unpublished skill remains in runtime cache")
	}
	t.Run("publish unpublish and rollback retain edited catalogue", func(t *testing.T) {
		router.PUT("/:id", UpdateSkill)
		router.POST("/:id/unpublish", UnpublishSkill)
		router.POST("/:id/releases/:releaseId/publish", PublishSkillRelease)
		router.POST("/:id/releases/:releaseId/rollback", RollbackSkillRelease)
		edit := `{"display_name":"中文名称","category":"管理员分类","description":"编辑描述","scenario":"编辑场景","tags":["编辑标签"],"icon":"glyph:bot"}`
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("PUT", "/"+strconv.Itoa(skill.Id), strings.NewReader(edit)))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"success":true`) {
			t.Fatalf("edit: %s", w.Body.String())
		}
		var latest model.SkillRelease
		if err := db.Where("skill_id = ? AND version = ?", skill.Id, "1.1.0").First(&latest).Error; err != nil {
			t.Fatal(err)
		}
		for _, action := range []string{
			"/releases/" + strconv.Itoa(latest.Id) + "/publish",
			"/unpublish",
			"/releases/" + strconv.Itoa(latest.Id) + "/publish",
			"/releases/" + strconv.Itoa(oldRelease.Id) + "/rollback",
		} {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("POST", "/"+strconv.Itoa(skill.Id)+action, nil))
			if w.Code != 200 || !strings.Contains(w.Body.String(), `"success":true`) {
				t.Fatalf("%s: %s", action, w.Body.String())
			}
			var stored model.Skill
			if err := db.First(&stored, skill.Id).Error; err != nil {
				t.Fatal(err)
			}
			if stored.DisplayName != "中文名称" || stored.Category != "管理员分类" || stored.Description != "编辑描述" || stored.Scenario != "编辑场景" || string(stored.Tags) != `["编辑标签"]` {
				t.Fatalf("%s replaced catalogue metadata: %#v", action, stored)
			}
			categories, err := model.ListSkillCategoriesForSkill(skill.Id)
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(categories)
			if !strings.Contains(string(encoded), "管理员分类") {
				t.Fatalf("%s replaced category relations: %s", action, encoded)
			}
			if action != "/unpublish" {
				cached := model.GetSkillByName(stored.Name)
				if cached == nil || cached.DisplayName != "中文名称" || cached.Category != "管理员分类" {
					t.Fatalf("%s did not preserve catalogue metadata in runtime cache", action)
				}
			}
		}
	})
}
