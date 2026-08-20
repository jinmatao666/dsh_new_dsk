package controller

import (
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

type skillResponse struct {
	Id              int                       `json:"id"`
	Name            string                    `json:"name"`
	DisplayName     string                    `json:"display_name"`
	Category        string                    `json:"category"`
	Description     string                    `json:"description"`
	Scenario        string                    `json:"scenario"`
	Submitter       string                    `json:"submitter"`
	Tags            any                       `json:"tags"`
	Downloads       int                       `json:"downloads"`
	Version         string                    `json:"version"`
	Status          int                       `json:"status"`
	IsDeleted       bool                      `json:"is_deleted"`
	CreatedAt       int64                     `json:"created_at"`
	UpdatedAt       int64                     `json:"updated_at"`
	BodyUpdatedAt   int64                     `json:"body_updated_at"`
	AssetsUpdatedAt int64                     `json:"assets_updated_at"`
	Categories      []model.SkillCategoryView `json:"categories,omitempty"`
}

func skillToResponse(s model.Skill, categories ...[]model.SkillCategoryView) skillResponse {
	var cats []model.SkillCategoryView
	if len(categories) > 0 {
		cats = categories[0]
	}
	return skillResponse{
		Id:              s.Id,
		Name:            s.Name,
		DisplayName:     s.DisplayName,
		Category:        s.Category,
		Description:     s.Description,
		Scenario:        s.Scenario,
		Submitter:       s.Submitter,
		Tags:            s.Tags,
		Downloads:       s.Downloads,
		Version:         s.Version,
		Status:          s.Status,
		IsDeleted:       s.IsDeleted,
		CreatedAt:       s.CreatedAt,
		UpdatedAt:       s.UpdatedAt,
		BodyUpdatedAt:   s.BodyUpdatedAt,
		AssetsUpdatedAt: s.AssetsUpdatedAt,
		Categories:      cats,
	}
}

func buildSkillCategoryFilter(c *gin.Context) model.SkillCategoryFilter {
	categoryId, _ := strconv.ParseUint(c.Query("category_id"), 10, 64)
	return model.SkillCategoryFilter{
		LegacyCategory: c.Query("category"),
		CategoryType:   c.Query("category_type"),
		CategoryCode:   c.Query("category_code"),
		CategoryId:     categoryId,
	}
}

func skillsToResponses(skills []model.Skill) ([]skillResponse, error) {
	ids := make([]int, 0, len(skills))
	for _, s := range skills {
		ids = append(ids, s.Id)
	}
	categoryMap, err := model.BatchListSkillCategoriesForSkills(ids)
	if err != nil {
		return nil, err
	}
	items := make([]skillResponse, len(skills))
	for i, s := range skills {
		items[i] = skillToResponse(s, categoryMap[s.Id])
	}
	return items, nil
}

// readRawJSON reads the request body once and returns both the parsed
// presence map (which keys appeared in the JSON) and the raw bytes for a
// secondary unmarshal into a typed struct. We need the presence map so the
// controller can distinguish "field omitted" (don't touch column) from "field
// set to empty string" (write empty), as required by plan §3.2.
func readRawJSON(c *gin.Context) ([]byte, map[string]json.RawMessage, error) {
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil, nil, err
	}
	if len(raw) == 0 {
		return raw, map[string]json.RawMessage{}, nil
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, nil, err
	}
	return raw, m, nil
}

func ListSkills(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "20"))
	keyword := c.Query("keyword")
	categoryFilter := buildSkillCategoryFilter(c)
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	// 公开列表:过滤禁用 + 过滤软删
	skills, total, err := model.SearchSkillsWithCategoryFilter(keyword, categoryFilter, page, perPage, false, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	items, err := skillsToResponses(skills)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))
	c.JSON(http.StatusOK, gin.H{
		"page":       page,
		"perPage":    perPage,
		"totalPages": totalPages,
		"totalItems": total,
		"items":      items,
	})
}

func GetSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	skill, err := model.GetSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	cats, _ := model.ListSkillCategoriesForSkill(skill.Id)
	c.JSON(http.StatusOK, skillToResponse(*skill, cats))
}

func GetSkillsMeta(c *gin.Context) {
	skills := model.GetAllSkillMeta()
	items := make([]skillResponse, len(skills))
	for i, s := range skills {
		items[i] = skillToResponse(s)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    items,
	})
}

// GetSkillDisplayNames 按 id 列表返回 {id: 中文名} 映射，供客户端清理已下架/移出包
// 技能后反查中文名展示。这些技能多半已被软删/禁用，不在 GetSkillsMeta 全集中，
// 故单独提供按 id 直查（不过滤 is_deleted/status）的轻量端点。
// 入参：?ids=1,2,3（逗号分隔）。
func GetSkillDisplayNames(c *gin.Context) {
	raw := c.Query("ids")
	ids := make([]int, 0)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if id, err := strconv.Atoi(part); err == nil {
			ids = append(ids, id)
		}
	}
	names, err := model.GetSkillDisplayNamesByIds(ids)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// JSON 对象键须为字符串，转换 id->string
	data := make(map[string]string, len(names))
	for id, name := range names {
		data[strconv.Itoa(id)] = name
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
	})
}

// GetSkillBundle returns the assets payload for a single public skill.
// Used by client-side sync/install to pull the bundled files (scripts/templates)
// that must live on the user's machine. The skill body (工作手册正文) is
// deliberately NOT returned here — it is injected server-side at chat time via
// the X-Parvis-Skills header (see middleware.SkillInject), so it never needs to
// be downloaded. Only visible skills (status==1 && !is_deleted) are served.
func GetSkillBundle(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	skill, err := model.GetVisibleSkillById(id)
	if err != nil {
		// 命中 not found 时不区分"不存在 / 已禁用 / 已软删"，统一返回，避免通过
		// bundle 探测被下架技能的存在性。GetVisibleSkillById 已按 status==1 &&
		// !is_deleted 过滤，普通登录用户无法再按 id 枚举拉到被禁用/软删技能的全文
		// （此前直查 GetSkillById 可绕过 ListSkills 的过滤口径）。
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			// 刻意不返回 body：skill 正文（工作手册）客户端本地不落盘、也不需要，
			// 问答时由服务端 SkillInject 中间件按 X-Parvis-Skills 头注入。bundle 只
			// 负责下发 assets（脚本/模板等必须落到用户机器上执行的随包文件）。
			// 这样把"批量下载正文"这条最廉价的泄露路径砍掉；正文仅剩注入路径可达，
			// 提取需逐次套话，成本大幅提高。body_updated_at 仅为时间戳，非内容，保留。
			"body":              "",
			"assets":            skill.Assets,
			"body_updated_at":   skill.BodyUpdatedAt,
			"assets_updated_at": skill.AssetsUpdatedAt,
		},
	})
}

func CreateSkill(c *gin.Context) {
	_, payload, err := readRawJSON(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	var skill model.Skill
	if v, ok := payload["name"]; ok {
		_ = json.Unmarshal(v, &skill.Name)
	}
	if v, ok := payload["display_name"]; ok {
		_ = json.Unmarshal(v, &skill.DisplayName)
	}
	if v, ok := payload["category"]; ok {
		_ = json.Unmarshal(v, &skill.Category)
	}
	if v, ok := payload["description"]; ok {
		_ = json.Unmarshal(v, &skill.Description)
	}
	if v, ok := payload["scenario"]; ok {
		_ = json.Unmarshal(v, &skill.Scenario)
	}
	if v, ok := payload["submitter"]; ok {
		_ = json.Unmarshal(v, &skill.Submitter)
	}
	if v, ok := payload["version"]; ok {
		_ = json.Unmarshal(v, &skill.Version)
	}
	if v, ok := payload["status"]; ok {
		_ = json.Unmarshal(v, &skill.Status)
	}
	if v, ok := payload["tags"]; ok {
		skill.Tags = v
	}

	now := time.Now().Unix()
	_, hasContent := payload["content"]
	_, hasBody := payload["body"]
	_, hasAssets := payload["assets"]

	if hasContent {
		_ = json.Unmarshal(payload["content"], &skill.Content)
	}
	if hasBody {
		_ = json.Unmarshal(payload["body"], &skill.Body)
		skill.BodyUpdatedAt = now
	}
	if hasAssets {
		_ = json.Unmarshal(payload["assets"], &skill.Assets)
		skill.AssetsUpdatedAt = now
	}

	// Auto-split: when caller only sent legacy `content` (no explicit body/assets),
	// carve the inline ## Script: / <!-- file: --> blocks into Body + Assets so
	// the new client-side sync path has data to pull.
	if hasContent && !hasBody && !hasAssets {
		if body, assetsText := model.SplitContent(skill.Content); assetsText != "" {
			skill.Body = body
			skill.Assets = assetsText
			skill.BodyUpdatedAt = now
			skill.AssetsUpdatedAt = now
		} else {
			skill.Body = skill.Content
			skill.BodyUpdatedAt = now
		}
	}

	if skill.Name == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "name is required",
		})
		return
	}
	if !hasContent && !hasBody {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "content or body is required",
		})
		return
	}

	// 重名检测:无论对方是正常还是已软删,都返回 409 让前端弹 [更新]/[替换]/[取消]
	if existing, err := model.GetSkillByNameAny(skill.Name); err == nil && existing != nil {
		c.JSON(http.StatusConflict, gin.H{
			"success":             false,
			"message":             "name exists",
			"existing_id":         existing.Id,
			"existing_is_deleted": existing.IsDeleted,
		})
		return
	}

	skill.CreatedAt = now
	skill.UpdatedAt = now

	if err := model.CreateSkill(&skill); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    skill,
	})
}

func UpdateSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	existing, err := model.GetSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	_, payload, err := readRawJSON(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}

	now := time.Now().Unix()

	if v, ok := payload["name"]; ok {
		_ = json.Unmarshal(v, &existing.Name)
	}
	if v, ok := payload["display_name"]; ok {
		_ = json.Unmarshal(v, &existing.DisplayName)
	}
	if v, ok := payload["category"]; ok {
		_ = json.Unmarshal(v, &existing.Category)
	}
	if v, ok := payload["description"]; ok {
		_ = json.Unmarshal(v, &existing.Description)
	}
	if v, ok := payload["scenario"]; ok {
		_ = json.Unmarshal(v, &existing.Scenario)
	}
	if v, ok := payload["submitter"]; ok {
		_ = json.Unmarshal(v, &existing.Submitter)
	}
	if v, ok := payload["version"]; ok {
		_ = json.Unmarshal(v, &existing.Version)
	}
	if v, ok := payload["status"]; ok {
		_ = json.Unmarshal(v, &existing.Status)
	}
	if v, ok := payload["tags"]; ok {
		existing.Tags = v
	}
	if v, ok := payload["content"]; ok {
		_ = json.Unmarshal(v, &existing.Content)
	}
	if v, ok := payload["body"]; ok {
		_ = json.Unmarshal(v, &existing.Body)
		existing.BodyUpdatedAt = now
	}
	if v, ok := payload["assets"]; ok {
		_ = json.Unmarshal(v, &existing.Assets)
		existing.AssetsUpdatedAt = now
	}

	// Auto-split when caller only updated legacy `content`.
	if _, hasContent := payload["content"]; hasContent {
		_, hasBody := payload["body"]
		_, hasAssets := payload["assets"]
		if !hasBody && !hasAssets {
			if body, assetsText := model.SplitContent(existing.Content); assetsText != "" {
				existing.Body = body
				existing.Assets = assetsText
				existing.BodyUpdatedAt = now
				existing.AssetsUpdatedAt = now
			} else {
				existing.Body = existing.Content
				existing.BodyUpdatedAt = now
			}
		}
	}

	existing.Id = id
	existing.UpdatedAt = now

	if err := model.UpdateSkill(existing); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    existing,
	})
}

func DeleteSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	// 默认软删;?force=1 走物理删
	force := c.Query("force") == "1"
	if force {
		if err := model.HardDeleteSkill(id); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	} else {
		if _, err := model.DeleteSkill(id); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

// RestoreSkill 恢复软删的 skill
func RestoreSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	if _, err := model.RestoreSkill(id); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

// ListSkillPackages 返回按 category 分组的技能包列表(专业广场使用)
func ListSkillPackages(c *gin.Context) {
	packages, err := model.ListSkillPackages()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	type pkgItem struct {
		Id          uint64 `json:"id"`
		Code        string `json:"code"`
		Name        string `json:"name"`
		Description string `json:"description"`
		SkillCount  int    `json:"skill_count"`
	}
	items := make([]pkgItem, len(packages))
	for i, p := range packages {
		items[i] = pkgItem{
			Id:          p.Id,
			Code:        p.Code,
			Name:        firstNonEmpty(p.Name, p.Category),
			Description: p.Description,
			SkillCount:  p.SkillCount,
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    items,
	})
}

// GetSkillPackageDetail 返回指定 category 下所有 skill 的简要信息
func GetSkillPackageDetail(c *gin.Context) {
	category := firstNonEmpty(c.Query("code"), c.Query("category"))
	if category == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "code or category is required",
		})
		return
	}
	skills, err := model.ListSkillsByCategory(category)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    skills,
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func ListSkillFunctionCategories(c *gin.Context) {
	categories, err := model.ListFunctionCategoriesForStandaloneSkills()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    categories,
	})
}

// ListSkillCategories 返回公库中未软删的所有 category 去重列表
func ListSkillCategories(c *gin.Context) {
	cats, err := model.ListSkillCategories()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    cats,
	})
}

// BatchSkill 批量操作:soft_delete / restore / set_category
func BatchSkill(c *gin.Context) {
	var req struct {
		Ids    []int  `json:"ids"`
		Action string `json:"action"`
		Value  string `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}
	if len(req.Ids) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "ids is required",
		})
		return
	}
	action := model.SkillBatchAction(req.Action)
	switch action {
	case model.SkillBatchSoftDelete, model.SkillBatchRestore:
	case model.SkillBatchSetCategory:
		if req.Value == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "category is required",
			})
			return
		}
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid action",
		})
		return
	}
	affected, err := model.BatchUpdateSkills(req.Ids, action, req.Value)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"affected": affected,
		},
	})
}

func IncrementSkillDownloads(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	if err := model.IncrementSkillDownloads(id); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func RefreshSkillCache(c *gin.Context) {
	if err := model.RefreshSkillCache(); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "skill cache refreshed",
	})
}

// AdminListSkills lists public skills including disabled (status=0). Admin-only.
func AdminListSkills(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "20"))
	keyword := c.Query("keyword")
	categoryFilter := buildSkillCategoryFilter(c)
	deletedFilter := model.SkillDeletedNormal
	switch c.Query("deleted") {
	case string(model.SkillDeletedOnly):
		deletedFilter = model.SkillDeletedOnly
	case string(model.SkillDeletedAll):
		deletedFilter = model.SkillDeletedAll
	default:
		// Preserve the old admin API contract for clients that still send
		// includeDeleted=1. The new UI uses deleted=deleted for an exact filter.
		if c.Query("includeDeleted") == "1" {
			deletedFilter = model.SkillDeletedAll
		}
	}
	sortField := c.Query("sort_field")
	sortOrder := c.Query("sort_order")
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	skills, total, err := model.SearchSkillsWithOptions(keyword, categoryFilter, page, perPage, true, deletedFilter, sortField, sortOrder)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	items, err := skillsToResponses(skills)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))
	c.JSON(http.StatusOK, gin.H{
		"page":       page,
		"perPage":    perPage,
		"totalPages": totalPages,
		"totalItems": total,
		"items":      items,
	})
}

// AdminGetSkillFull returns a public skill with body/assets/content all
// included. The public GET /:id intentionally hides content; this admin-only
// variant is for the management UI.
func AdminGetSkillFull(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	skill, err := model.GetSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	categories, err := model.ListSkillCategoriesForSkill(skill.Id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	type skillFullResponse struct {
		model.Skill
		Categories []model.SkillCategoryView `json:"categories"`
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": skillFullResponse{
			Skill:      *skill,
			Categories: categories,
		},
	})
}
