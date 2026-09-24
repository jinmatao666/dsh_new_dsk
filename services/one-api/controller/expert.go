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

// These are presentation defaults only. Saved administrator copy always wins.
func defaultExpertSections(key string) string {
	type section struct {
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
		Content  string `json:"content"`
	}
	var rows []section
	switch key {
	case "geology-analysis":
		rows = []section{{"适用场景", "前期资料研判", "适合项目选址和规划前期了解地块的地质环境、地质灾害易发性及需要进一步核实的问题。结果供资料研判参考，不替代现场勘察、专项评估或工程设计。"}, {"需要准备的材料", "项目范围数据", "提供面或多面的 GeoJSON、完整 Shape ZIP，或同名的 .shp、.shx、.dbf 文件；有 .prj 请一并提供。坐标系无法识别时需明确说明，分区名称字段与源数据不同时可在高级选项中修改。"}, {"交付成果", "以实际任务为准", "完成后可在任务中查看地质环境与灾害易发性分析结论，并打开实际生成的 Word 专业报告和 Excel 明细；未成功生成的文件不会作为成果展示。"}, {"专业方向", "分析边界", "围绕项目范围与相关地质资料进行空间研判，提示易发分区、主要关注点与后续核实方向；不自动作出建设适宜性审批结论。"}}
	case "third-survey-analysis":
		rows = []section{{"适用场景", "用地现状研判", "适合项目选址、前期用地摸底和三调地类构成核对，帮助了解项目范围内主要地类、面积及耕地保护相关情况。分析不替代权属调查或正式审批。"}, {"需要准备的材料", "范围与年度", "提供面或多面的 GeoJSON、完整 Shape ZIP，或同名的 .shp、.shx、.dbf 文件；有 .prj 请一并提供。核对坐标系及三调年度，默认年度为 2024。"}, {"交付成果", "以实际任务为准", "完成后可查看三调土地利用现状分析结论，以及本次任务实际生成的 Word 报告和 Excel 明细；面积、地类等关键数据请结合原始资料复核。"}, {"专业方向", "分析边界", "关注三调地类与面积构成、耕地相关情况及需要进一步核实的差异；不能据此直接认定土地权属、审批结果或最新土地现状。"}}
	case "land-use-plan-review":
		rows = []section{{"适用场景", "规划前置审查", "适合项目选址和方案前期核对项目范围与规划管控要求的空间关系，识别可能的冲突范围、风险事项和后续核实重点。结果不等同于主管部门审查意见。"}, {"需要准备的材料", "范围与审查类别", "提供面或多面的 GeoJSON、完整 Shape ZIP，或同名的 .shp、.shx、.dbf 文件；有 .prj 请一并提供。坐标系无法识别时需说明；审查类别默认为 4，仅在有明确业务依据时修改。"}, {"交付成果", "以实际任务为准", "完成后可查看规划审查分析结论，并打开本次任务实际生成的 Word 报告和 Excel 明细；冲突和风险提示应结合现行规划资料人工复核。"}, {"专业方向", "分析边界", "围绕规划符合性、用途管制和空间冲突进行资料研判，不替代行政审批、法定规划核验或最终合规认定。"}}
	case "meeting-minutes":
		rows = []section{{"适用场景", "会议内容整理", "适合例会、项目沟通、评审会等需要将录音或已有文字材料整理为正式纪要的场景。材料可以只有转写稿或文字文件，不要求必须上传录音。"}, {"需要准备的材料", "录音与补充资料", "最多提供一个 WAV、M4A 或 MP3 录音，可同时添加多个可读取的文本、Word、PDF 或表格材料。扫描 PDF 无可提取文字时请先做 OCR；议程和转写稿有助于核对发言内容。"}, {"本专家交付", "一份 Word 纪要", "每个成功任务交付一份结构化 Word 会议纪要；转写文本属于处理过程，不在成果页单独交付。时间、参会人、责任人等未在材料中明确的信息会标注为“未明确”。"}, {"处理原则", "忠于会议来源", "依据实际录音和材料整理议题、结论与行动事项，不凭空补出决议、负责人或截止日期；正式对外使用前请结合原始材料复核。"}}
	case "file-conversion-pdf":
		rows = []section{{"适用场景", "常用文件处理", "适合将 Word 转为 PDF、导出 PDF 页面图片、合并或拆分 PDF、将图片整理成 PDF，以及批量压缩和转换图片格式。一次任务选择一种工具，原文件不会被覆盖。"}, {"需要准备的材料", "按工具选择文件", "Word 转 PDF 接收 DOC、DOCX、DOCM；PDF 工具接收 PDF；图片工具接收 JPG、JPEG、PNG、WebP。请检查页码范围、图片顺序和输出参数，Word 转 PDF 还依赖本机可用的转换器。"}, {"交付成果", "真实处理文件", "任务完成后在成果页查看本次实际生成的 PDF 或图片。转换后的排版、清晰度与文件内容取决于输入质量和本机转换环境，重要文件请打开结果复核。"}, {"处理原则", "只做选定操作", "不会替您修改文档内容或推断缺失页。非法页码、损坏文件或缺少转换依赖会如实报错，不会把未生成的文件显示为成功成果。"}}
	case "document-intelligence":
		rows = []section{{"适用场景", "阅读与版本核对", "适合快速阅读政策、报告、合同和项目材料，提炼摘要、重点、风险、时间节点及待办事项；也可比较原始版与新版可提取文本的变化。"}, {"需要准备的材料", "可读取文档", "摘要任务可提供一份或多份 DOCX、PDF、XLSX、XLSM 或常见文本材料；对比任务按顺序提供原始版和新版各一份。扫描 PDF 没有可提取文字时需先做 OCR。"}, {"交付成果", "摘要或差异结果", "摘要任务交付结构化摘要与来源说明；对比任务交付可提取文本的新增、删除、修改及重点变化结果。请以任务中实际生成的文件为准，并回到原文核对关键数字和结论。"}, {"处理原则", "不比较视觉排版", "版本对比不识别版式、图片、批注或修订痕迹，也不支持旧版 DOC、XLS 和 PPT；不修改原文件，不将推断内容当成已证实事实。"}}
	}
	data, _ := json.Marshal(rows)
	return string(data)
}

type expertSection struct {
	Title    string `json:"title"`
	Subtitle string `json:"subtitle"`
	Content  string `json:"content"`
}

// Upgrade only the recognizable old editor template. User-authored blocks stay intact.
func displayExpertSections(profile model.ExpertProfile) string {
	if strings.TrimSpace(profile.DetailSections) == "" || profile.DetailSections == "[]" {
		return defaultExpertSections(profile.Key)
	}
	var existing, defaults []expertSection
	if json.Unmarshal([]byte(profile.DetailSections), &existing) != nil || len(existing) != 4 ||
		json.Unmarshal([]byte(defaultExpertSections(profile.Key)), &defaults) != nil || len(defaults) != 4 {
		return profile.DetailSections
	}
	if existing[2].Title == defaults[2].Title && strings.TrimSpace(existing[2].Content) == "" {
		existing[2].Content = defaults[2].Content
	}
	var tags []string
	_ = json.Unmarshal([]byte(profile.Tags), &tags)
	if existing[3].Title == defaults[3].Title && strings.TrimSpace(existing[3].Content) == strings.Join(tags, "\n") {
		existing[3].Content = defaults[3].Content
	}
	data, _ := json.Marshal(existing)
	return string(data)
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
			profile.DetailSections = displayExpertSections(profile)
			result = append(result, profile)
		} else {
			profile := defaultExpertProfile(shipped.Key)
			profile.RelatedSkills = encodedStrings(shipped.SkillKeys)
			profile.DetailSections = defaultExpertSections(shipped.Key)
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
