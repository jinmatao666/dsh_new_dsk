package controller

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSkillTestDatabaseHistoryOwnershipAndEnding(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "reviews.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	previous := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previous; sql.Close() })
	if err = db.AutoMigrate(&model.PersonalSkill{}, &model.SkillTestSession{}); err != nil {
		t.Fatal(err)
	}
	skill := model.PersonalSkill{Name: "upload", Owner: "uploader", Visibility: model.PersonalSkillPublic, ReviewStatus: model.PersonalSkillReviewPending, Assets: "snapshot", Version: "1"}
	if err = db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	session := model.SkillTestSession{Id: strings.Repeat("a", 32), SkillId: skill.Id, ReviewerId: 7, Status: "idle", Version: skill.Version, SourceUpdatedAt: skill.UpdatedAt, SourceSubmittedAt: skill.SubmittedAt, SnapshotHash: skillTestHash(&skill), Snapshot: "private uploaded bytes", Transcript: `[{"role":"system","content":"中文审核"}]`, Events: "[]", ExpiresAt: time.Now().Unix() + 600}
	if err = db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	runner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/status" {
			w.Write([]byte(`{"active":true}`))
		} else {
			w.Write([]byte(`{"ended":true}`))
		}
	}))
	defer runner.Close()
	t.Setenv("SKILL_TEST_RUNNER_URL", runner.URL)
	t.Setenv("SKILL_TEST_RUNNER_SECRET", strings.Repeat("s", 32))
	router := gin.New()
	router.Use(func(c *gin.Context) {
		if c.GetHeader("Owner") == "yes" {
			c.Set("id", 7)
		} else {
			c.Set("id", 8)
		}
	})
	router.GET("/:session", GetSkillTest)
	router.POST("/:session/finish", EndSkillTest)
	request := func(method, target, owner string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader("{}"))
		req.Header.Set("Owner", owner)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	view := request("GET", "/"+session.Id, "yes")
	if view.Code != 200 || strings.Contains(view.Body.String(), session.Snapshot) || !strings.Contains(view.Body.String(), `"outdated":false`) {
		t.Fatalf("snapshot view: %s", view.Body.String())
	}
	if res := request("POST", "/"+session.Id+"/finish", "no"); res.Code != 403 {
		t.Fatalf("non-owner end: %d", res.Code)
	}
	if err = db.Model(&skill).Update("review_status", model.PersonalSkillReviewApproved).Error; err != nil {
		t.Fatal(err)
	}
	if res := request("GET", "/"+session.Id, "yes"); !strings.Contains(res.Body.String(), `"outdated":true`) {
		t.Fatal("approved snapshot not marked read-only")
	}
	if res := request("POST", "/"+session.Id+"/finish", "yes"); res.Code != 200 {
		t.Fatalf("end: %s", res.Body.String())
	}
	var saved model.SkillTestSession
	if err = db.First(&saved, "id = ?", session.Id).Error; err != nil || saved.Status != "ended" {
		t.Fatalf("saved status=%s err=%v", saved.Status, err)
	}
	var count int64
	db.Model(&model.SkillTestSession{}).Count(&count)
	if count != 1 {
		t.Fatal("ending removed audit record")
	}
}
