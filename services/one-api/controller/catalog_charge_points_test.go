package controller

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCatalogChargePoints(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old; conn.Close() })
	require.NoError(t, db.AutoMigrate(&model.BillingRule{}, &model.ExpertWebProfile{}, &model.ExpertCategory{},
		&model.Skill{}, &model.SkillRelease{}, &model.SkillCategory{}, &model.SkillCategoryType{}, &model.SkillCategoryRelation{}, &model.SkillInstallation{}))
	for _, rule := range []model.BillingRule{
		{ID: "cp_paid", Kind: "expert", ItemID: "paid-expert", Action: "report", Name: "生成报告", UnitQuota: int64(config.QuotaPerUnit * 3), Enabled: true},
		{ID: "cp_decimal", Kind: "expert", ItemID: "paid-expert", Action: "export", Name: "导出成果", UnitQuota: int64(config.QuotaPerUnit / 2), Enabled: true},
		{ID: "cp_free", Kind: "expert", ItemID: "paid-expert", Action: "preview", Name: "查看预览", Enabled: true},
		{ID: "cp_off", Kind: "expert", ItemID: "paid-expert", Action: "off", UnitQuota: 99, Enabled: false},
		{ID: "cp_deleted", Kind: "expert", ItemID: "paid-expert", Action: "deleted", UnitQuota: 99, Enabled: true, IsDeleted: true},
		{ID: "cp_default", Kind: "skill", ItemID: "skill-a", Action: "default", Name: "技能调用", UnitQuota: int64(config.QuotaPerUnit * 2), Enabled: true},
		{ID: "cp_disabled_default", Kind: "skill", ItemID: "skill-b", Action: "default", Enabled: false},
	} {
		require.NoError(t, db.Create(&rule).Error)
	}
	prices, err := catalogChargePoints("skill", map[string]int64{"skill-a": 99, "skill-b": 99, "skill-c": 4})
	require.NoError(t, err)
	require.Equal(t, []catalogChargePoint{{"cp_default", "技能调用", 2}}, prices["skill-a"])
	require.Empty(t, prices["skill-b"])
	require.Equal(t, []catalogChargePoint{{"default", "技能调用", 4}}, prices["skill-c"])
	require.NoError(t, db.Create(&model.ExpertWebProfile{Key: "paid-expert", Name: "计费专家", Published: true}).Error)
	require.NoError(t, db.Create(&model.ExpertWebProfile{Key: "free-expert", Name: "免费专家", Published: true}).Error)
	router := gin.New()
	router.GET("/catalog", ListExpertWebCatalog)
	require.NoError(t, db.Create(&model.Skill{Name: "skill-a", Status: 1, TaskCredits: 99}).Error)
	router.GET("/skills", ListSkills)
	skills := httptest.NewRecorder()
	router.ServeHTTP(skills, httptest.NewRequest("GET", "/skills", nil))
	require.Equal(t, 200, skills.Code)
	var skillResponse struct {
		Items []struct {
			Points []catalogChargePoint `json:"charge_points"`
		} `json:"items"`
	}
	require.NoError(t, json.Unmarshal(skills.Body.Bytes(), &skillResponse))
	require.Len(t, skillResponse.Items, 1)
	require.Equal(t, []catalogChargePoint{{"cp_default", "技能调用", 2}}, skillResponse.Items[0].Points)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/catalog", nil))
	require.Equal(t, 200, w.Code)
	var response struct {
		Data []struct {
			Key    string               `json:"key"`
			Points []catalogChargePoint `json:"charge_points"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	require.Len(t, response.Data, 2)
	for _, entry := range response.Data {
		if entry.Key == "paid-expert" {
			require.ElementsMatch(t, []catalogChargePoint{{"cp_paid", "生成报告", 3}, {"cp_decimal", "导出成果", 0.5}}, entry.Points)
		} else {
			require.NotNil(t, entry.Points)
			require.Empty(t, entry.Points)
		}
	}
}
