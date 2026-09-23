package controller

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// ShippedExpert is the server-side roster of desktop workbenches. A profile
// may change how a shipped workbench is presented, never how it executes.
type ShippedExpert struct {
	Key      string `json:"key"`
	SkillKey string `json:"skill_key"`
}

var shippedExperts = []ShippedExpert{{Key: "geology-analysis", SkillKey: "market-gis-geology-analysis"}}

func shippedExpert(key string) (ShippedExpert, bool) {
	for _, expert := range shippedExperts {
		if expert.Key == key {
			return expert, true
		}
	}
	return ShippedExpert{}, false
}

func defaultExpertProfile(key string) model.ExpertProfile {
	return model.ExpertProfile{
		Key: key, Name: "地质条件分析专家", Subtitle: "地质环境与灾害易发性分析",
		Category: "空间分析", Summary: "提交项目地块范围，分析地质环境条件与地质灾害易发性，查看 Excel 明细和 Word 专业报告。",
		Icon: "gis", Tags: `["地质环境","灾害易发性","专业报告"]`,
		Scenario:      "适用于项目选址、规划前期资料研判及地质灾害易发性分析。",
		Materials:     "提供面或多面的 GeoJSON、完整 Shape 文件或 Shape ZIP；坐标系无法从文件识别时需人工确认。",
		RelatedSkills: `[]`,
	}
}

func expertProfiles() ([]model.ExpertProfile, error) {
	stored := make([]model.ExpertProfile, 0)
	if err := model.DB.Find(&stored).Error; err != nil {
		return nil, err
	}
	byKey := make(map[string]model.ExpertProfile, len(stored))
	for _, profile := range stored {
		byKey[profile.Key] = profile
	}
	result := make([]model.ExpertProfile, 0, len(shippedExperts))
	for _, shipped := range shippedExperts {
		if profile, ok := byKey[shipped.Key]; ok {
			result = append(result, profile)
		} else {
			result = append(result, defaultExpertProfile(shipped.Key))
		}
	}
	return result, nil
}

func AdminListExperts(c *gin.Context) {
	profiles, err := expertProfiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": profiles, "workbenches": shippedExperts})
}

func ListPublishedExperts(c *gin.Context) {
	profiles, err := expertProfiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	published := make([]model.ExpertProfile, 0, len(profiles))
	for _, profile := range profiles {
		if profile.Published {
			published = append(published, profile)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": published})
}

func UpdateExpert(c *gin.Context) {
	key := c.Param("key")
	if _, ok := shippedExpert(key); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "当前版本没有这个专家的工作台"})
		return
	}
	var input model.ExpertProfile
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "专家资料格式无效"})
		return
	}
	input.Key = key
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len([]rune(input.Name)) > 100 || len([]rune(input.Summary)) > 500 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请填写名称，简介不超过 500 字"})
		return
	}
	if input.Tags == "" {
		input.Tags = `[]`
	}
	if input.RelatedSkills == "" {
		input.RelatedSkills = `[]`
	}
	var tags []string
	var skills []string
	if err := json.Unmarshal([]byte(input.Tags), &tags); err != nil || len(tags) > 12 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "标签格式无效"})
		return
	}
	if err := json.Unmarshal([]byte(input.RelatedSkills), &skills); err != nil || len(skills) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "关联技能格式无效"})
		return
	}
	if err := model.DB.Save(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": input})
}
