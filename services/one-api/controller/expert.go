package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

// ShippedExpert is the server-side roster of desktop workbenches. A profile
// may change how a shipped workbench is presented, never how it executes.
type ShippedExpert struct {
	Key       string   `json:"key"`
	SkillKey  string   `json:"skill_key"`
	SkillKeys []string `json:"skill_keys"`
}

var shippedExperts = []ShippedExpert{
	{Key: "geology-analysis", SkillKey: "market-gis-geology-analysis", SkillKeys: []string{"market-gis-geology-analysis"}},
	{Key: "third-survey-analysis", SkillKey: "market-gis-third-survey-analysis", SkillKeys: []string{"market-gis-third-survey-analysis"}},
	{Key: "land-use-plan-review", SkillKey: "market-gis-land-use-plan-review", SkillKeys: []string{"market-gis-land-use-plan-review"}},
	{Key: "file-conversion-pdf", SkillKey: "office-word-to-pdf", SkillKeys: []string{"office-word-to-pdf", "office-pdf-to-images", "office-pdf-organizer", "office-images-to-pdf", "office-image-optimizer"}},
	{Key: "document-intelligence", SkillKey: "office-document-summary", SkillKeys: []string{"office-document-summary", "office-document-compare"}},
	{Key: "meeting-minutes", SkillKey: "office-meeting-minutes", SkillKeys: []string{"office-meeting-minutes"}},
}

func encodedStrings(values []string) string {
	data, _ := json.Marshal(values)
	return string(data)
}

func shippedExpert(key string) (ShippedExpert, bool) {
	for _, expert := range shippedExperts {
		if expert.Key == key {
			return expert, true
		}
	}
	return ShippedExpert{}, false
}

func defaultExpertProfile(key string) model.ExpertProfile {
	if key == "third-survey-analysis" {
		return model.ExpertProfile{Key: key, Name: "三调土地利用现状分析专家", Subtitle: "三调地类、面积与权属现状分析", Category: "空间分析", Summary: "提交项目地块范围，分析三调土地利用现状、主要地类构成及耕地保护相关情况，查看专业报告和明细。", Icon: "survey", Tags: `["三调现状","地类构成","耕地保护"]`, Scenario: "项目选址、用地现状研判、前期资料核验。", Materials: "GeoJSON、完整 Shape 文件或 Shape ZIP；坐标系无法识别时需人工确认。", RelatedSkills: `[]`}
	}
	if key == "land-use-plan-review" {
		return model.ExpertProfile{Key: key, Name: "土地利用规划审查专家", Subtitle: "规划符合性与用途管制审查", Category: "空间分析", Summary: "提交项目地块范围，审查项目与规划管控要求的空间关系，识别冲突范围、风险事项和需进一步核实内容。", Icon: "planning", Tags: `["规划审查","用途管制","合规风险"]`, Scenario: "项目选址、规划前置审查、用地合规研判。", Materials: "GeoJSON、完整 Shape 文件或 Shape ZIP；坐标系无法识别时需人工确认。", RelatedSkills: `[]`}
	}
	if key == "file-conversion-pdf" {
		return model.ExpertProfile{Key: key, Name: "文件转换与 PDF 工具专家", Subtitle: "常用文档、PDF 与图片批量处理", Category: "办公工具", Summary: "提供 Word 转 PDF、PDF 转图片、PDF 合并拆分、图片转 PDF，以及图片压缩与格式转换能力。", Icon: "writing", Tags: `["文件转换","PDF 工具","图片处理"]`, Scenario: "办公文件转换、PDF 页面整理、图片归档和批量图片优化。", Materials: "根据所选工具提供 Word、PDF 或 JPG、JPEG、PNG、WebP 图片文件。", RelatedSkills: `[]`}
	}
	if key == "document-intelligence" {
		return model.ExpertProfile{Key: key, Name: "文档智能处理专家", Subtitle: "摘要提炼与版本差异分析", Category: "办公工具", Summary: "读取办公文档，提取摘要、重点、风险、时间节点和待办事项，或比较两份材料的新增、删除及关键变化。", Icon: "writing", Tags: `["文档摘要","要点提取","文档对比"]`, Scenario: "政策文件、项目报告、合同、制度和会议材料的快速阅读及版本变化核对。", Materials: "摘要任务提供一份或多份可读取文档；对比任务提供原始版本和新版本各一份。", RelatedSkills: `[]`}
	}
	if key == "meeting-minutes" {
		return model.ExpertProfile{
			Key: key, Name: "会议纪要专家", Subtitle: "录音转写与结构化纪要",
			Category: "办公工具", Summary: "提交会议录音、已有转写稿和相关文字材料，生成结构清晰的 Word 会议纪要。",
			Icon: "meeting", Tags: `["录音转写","会议纪要","行动事项"]`,
			Scenario:      "适用于例会、项目沟通、评审会及访谈材料整理。",
			Materials:     "最多一个 WAV、M4A 或 MP3 录音，可同时提供多个可读取的文字材料；也支持仅使用文字材料。",
			RelatedSkills: `[]`,
		}
	}
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
			profile.RelatedSkills = encodedStrings(shipped.SkillKeys)
			result = append(result, profile)
		} else {
			profile := defaultExpertProfile(shipped.Key)
			profile.RelatedSkills = encodedStrings(shipped.SkillKeys)
			result = append(result, profile)
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
	shipped, ok := shippedExpert(key)
	if !ok {
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
	if err := model.ValidateExpertCategory(input.Category); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if input.Tags == "" {
		input.Tags = `[]`
	}
	input.RelatedSkills = encodedStrings(shipped.SkillKeys)
	var tags []string
	if err := json.Unmarshal([]byte(input.Tags), &tags); err != nil || len(tags) > 12 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "标签格式无效"})
		return
	}
	if err := model.DB.Save(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": input})
}

func SetExpertPublished(c *gin.Context) {
	key := c.Param("key")
	shipped, ok := shippedExpert(key)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "当前版本没有这个专家的工作台"})
		return
	}
	var request struct {
		Published bool `json:"published"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "上下架状态无效"})
		return
	}
	var profile model.ExpertProfile
	result := model.DB.Where("key = ?", key).First(&profile)
	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		profile = defaultExpertProfile(key)
		profile.RelatedSkills = encodedStrings(shipped.SkillKeys)
	} else if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": result.Error.Error()})
		return
	}
	profile.Published = request.Published
	if err := model.DB.Save(&profile).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": profile})
}

func ListExpertCategories(c *gin.Context) {
	query := model.DB.Model(&model.ExpertCategory{})
	if c.Query("includeDisabled") != "1" {
		query = query.Where("status = ?", 1)
	}
	var categories []model.ExpertCategory
	if err := query.Order("sort_order ASC, id ASC").Find(&categories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	type categoryView struct {
		model.ExpertCategory
		ExpertCount int64 `json:"expert_count"`
		TeamCount   int64 `json:"team_count"`
	}
	result := make([]categoryView, 0, len(categories))
	for _, category := range categories {
		var count int64
		if err := model.DB.Model(&model.ExpertProfile{}).Where("category = ?", category.Name).Count(&count).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		result = append(result, categoryView{ExpertCategory: category, ExpertCount: count, TeamCount: 0})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

func CreateExpertCategory(c *gin.Context) {
	var input model.ExpertCategory
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "分类资料格式无效"})
		return
	}
	input.Id = 0
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if input.Name == "" || len([]rune(input.Name)) > 80 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请填写不超过 80 字的分类名称"})
		return
	}
	if input.Status != 0 {
		input.Status = 1
	}
	if err := model.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "分类名称已存在或资料无效"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": input})
}

func UpdateExpertCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "分类编号无效"})
		return
	}
	var previous model.ExpertCategory
	if err := model.DB.First(&previous, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "分类不存在"})
		return
	}
	var input model.ExpertCategory
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "分类资料格式无效"})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len([]rune(input.Name)) > 80 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请填写不超过 80 字的分类名称"})
		return
	}
	if input.Status == 0 {
		var used int64
		if err := model.DB.Model(&model.ExpertProfile{}).Where("category = ?", previous.Name).Count(&used).Error; err != nil || used > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "该分类仍绑定专家，不能禁用"})
			return
		}
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if previous.Name != input.Name {
			if err := tx.Model(&model.ExpertProfile{}).Where("category = ?", previous.Name).Update("category", input.Name).Error; err != nil {
				return err
			}
		}
		return tx.Model(&previous).Updates(map[string]interface{}{"name": input.Name, "description": strings.TrimSpace(input.Description), "status": input.Status, "sort_order": input.SortOrder}).Error
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "保存分类失败，名称可能已存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func DeleteExpertCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "分类编号无效"})
		return
	}
	var category model.ExpertCategory
	if err := model.DB.First(&category, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "分类不存在"})
		return
	}
	var used int64
	if err := model.DB.Model(&model.ExpertProfile{}).Where("category = ?", category.Name).Count(&used).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	if used > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "该分类仍绑定专家，请先调整专家分类"})
		return
	}
	if err := model.DB.Delete(&category).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
