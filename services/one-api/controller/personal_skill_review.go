package controller

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

type personalSkillSubmission struct {
	Name        string          `json:"name"`
	DisplayName string          `json:"display_name"`
	Category    string          `json:"category"`
	Icon        string          `json:"icon"`
	Description string          `json:"description"`
	Body        string          `json:"body"`
	Assets      string          `json:"assets"`
	Visibility  string          `json:"visibility"`
	Tags        json.RawMessage `json:"tags"`
}

func validatePersonalSkillAssets(raw string) error {
	var bundle skillPackage
	if err := json.Unmarshal([]byte(raw), &bundle); err != nil {
		return fmt.Errorf("技能文件集合格式无效：%w", err)
	}
	if len(bundle.Files) == 0 || len(bundle.Files) > maxSkillFiles {
		return fmt.Errorf("技能必须包含 1 至 %d 个文件", maxSkillFiles)
	}
	seen := map[string]bool{}
	total := int64(0)
	for _, file := range bundle.Files {
		cleaned, err := cleanSkillArchivePath(file.Path)
		if err != nil {
			return err
		}
		if file.Path != cleaned {
			return fmt.Errorf("技能文件路径必须使用规范的正斜杠相对路径：%s", file.Path)
		}
		if seen[cleaned] {
			return fmt.Errorf("技能包包含重复文件 %s", cleaned)
		}
		seen[cleaned] = true
		content, err := base64.StdEncoding.DecodeString(file.ContentBase64)
		if err != nil {
			return fmt.Errorf("技能文件 %s 内容无效", cleaned)
		}
		if len(content) > maxSkillFileBytes {
			return fmt.Errorf("技能文件 %s 不能超过 %d MB", cleaned, maxSkillFileBytes/(1024*1024))
		}
		total += int64(len(content))
		if total > maxSkillPackageBytes {
			return fmt.Errorf("技能文件总大小不能超过 %d MB", maxSkillPackageBytes/(1024*1024))
		}
	}
	if !seen["SKILL.md"] {
		return fmt.Errorf("技能目录根部缺少 SKILL.md")
	}
	return nil
}

func nextPersonalSkillVersion(current, published string) string {
	if published == "" || current != published {
		if current == "" {
			return "1.0.0"
		}
		return current
	}
	parts := strings.Split(published, ".")
	if len(parts) != 3 {
		return published + ".1"
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		return published + ".1"
	}
	return fmt.Sprintf("%s.%s.%d", parts[0], parts[1], patch+1)
}

// SubmitPersonalSkill stores a private backup or opens a public review without
// changing the package currently visible in the marketplace.
func SubmitPersonalSkill(c *gin.Context) {
	var input personalSkillSubmission
	if err := c.ShouldBindJSON(&input); err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("上传参数无效：%w", err))
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.Category = strings.TrimSpace(input.Category)
	input.Description = strings.TrimSpace(input.Description)
	if input.Name == "" || input.DisplayName == "" {
		skillError(c, http.StatusBadRequest, fmt.Errorf("技能标识和显示名称不能为空"))
		return
	}
	if !skillSlugPattern.MatchString(input.Name) || len(input.Name) > 100 {
		skillError(c, http.StatusBadRequest, fmt.Errorf("技能标识必须是长度不超过 100 的 kebab-case 名称"))
		return
	}
	if len(input.DisplayName) > 100 || len(input.Category) > 100 || len(input.Description) > 500 {
		skillError(c, http.StatusBadRequest, fmt.Errorf("技能名称、分类或说明过长"))
		return
	}
	if input.Visibility != model.PersonalSkillPrivate && input.Visibility != model.PersonalSkillPublic {
		skillError(c, http.StatusBadRequest, fmt.Errorf("技能可见范围无效"))
		return
	}
	if err := validatePersonalSkillAssets(input.Assets); err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	if input.Category == "" {
		input.Category = model.DefaultSkillCategoryName
	}
	now := time.Now().Unix()
	owner := c.GetString(ctxkey.Username)
	existing, err := model.GetPersonalSkillByOwnerAndName(owner, input.Name)
	if err != nil && err != gorm.ErrRecordNotFound {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	if existing == nil {
		existing = &model.PersonalSkill{Name: input.Name, Owner: owner, Version: "1.0.0", CreatedAt: now}
	}
	existing.DisplayName = input.DisplayName
	existing.Category = input.Category
	existing.Icon = model.NormalizeSkillIcon(input.Icon)
	existing.Description = input.Description
	existing.Scenario = input.Description
	existing.Body = input.Body
	existing.Content = input.Body
	existing.Assets = input.Assets
	existing.Visibility = input.Visibility
	existing.Tags = input.Tags
	existing.BodyUpdatedAt = now
	existing.AssetsUpdatedAt = now
	existing.UpdatedAt = now
	if input.Visibility == model.PersonalSkillPublic {
		existing.Version = nextPersonalSkillVersion(existing.Version, existing.PublishedVersion)
		existing.ReviewStatus = model.PersonalSkillReviewPending
		existing.ReviewReason = ""
		existing.ReviewedBy = ""
		existing.ReviewedAt = 0
		existing.SubmittedAt = now
	} else {
		existing.ReviewStatus = model.PersonalSkillReviewNone
		existing.ReviewReason = ""
	}
	if existing.Id == 0 {
		err = model.CreatePersonalSkill(existing)
	} else {
		err = model.UpdatePersonalSkill(existing)
	}
	if err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": existing})
}

// AdminListPersonalSkillReviews lists public personal-skill submissions for review.
func AdminListPersonalSkillReviews(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "20"))
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	items, total, err := model.SearchPersonalSkillReviews(strings.TrimSpace(c.Query("keyword")), c.Query("status"), page, perPage)
	if err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"page": page, "perPage": perPage, "totalPages": int(math.Ceil(float64(total) / float64(perPage))),
		"totalItems": total, "items": items,
	})
}

func rewriteSkillName(source, slug string) (string, error) {
	lines := strings.Split(strings.TrimPrefix(source, "\ufeff"), "\n")
	for index, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "name:") {
			indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			lines[index] = indent + "name: " + slug
			return strings.Join(lines, "\n"), nil
		}
	}
	return "", fmt.Errorf("SKILL.md 必须声明 name")
}

func communitySkillPackage(personal model.PersonalSkill) (string, string, importedManifest, int, int64, error) {
	var bundle skillPackage
	if err := json.Unmarshal([]byte(personal.Assets), &bundle); err != nil {
		return "", "", importedManifest{}, 0, 0, err
	}
	slug := fmt.Sprintf("community-%d", personal.Id)
	manifest := importedManifest{
		Name: slug, Slug: slug, Version: personal.Version, DisplayName: personal.DisplayName,
		Category: personal.Category, Description: personal.Description, Summary: personal.Scenario,
		Author: personal.Owner, Icon: model.NormalizeSkillIcon(personal.Icon),
	}
	if err := json.Unmarshal(personal.Tags, &manifest.Tags); err != nil || len(manifest.Tags) == 0 {
		manifest.Tags = []string{"通用能力"}
	}
	manifest.Files = make([]string, 0, len(bundle.Files)+1)
	body := ""
	foundManifest := false
	total := int64(0)
	for index := range bundle.Files {
		file := &bundle.Files[index]
		if file.Path == "manifest.json" {
			foundManifest = true
			continue
		}
		manifest.Files = append(manifest.Files, file.Path)
		if file.Path == "SKILL.md" {
			decoded, err := base64.StdEncoding.DecodeString(file.ContentBase64)
			if err != nil {
				return "", "", importedManifest{}, 0, 0, err
			}
			body, err = rewriteSkillName(string(decoded), slug)
			if err != nil {
				return "", "", importedManifest{}, 0, 0, err
			}
			file.ContentBase64 = base64.StdEncoding.EncodeToString([]byte(body))
		}
		decoded, _ := base64.StdEncoding.DecodeString(file.ContentBase64)
		total += int64(len(decoded))
	}
	manifest.Files = append([]string{"manifest.json"}, manifest.Files...)
	if body == "" {
		return "", "", importedManifest{}, 0, 0, fmt.Errorf("技能目录根部缺少有效的 SKILL.md")
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return "", "", importedManifest{}, 0, 0, err
	}
	manifestFile := skillPackageFile{Path: "manifest.json", ContentBase64: base64.StdEncoding.EncodeToString(manifestJSON)}
	if foundManifest {
		for index := range bundle.Files {
			if bundle.Files[index].Path == "manifest.json" {
				bundle.Files[index] = manifestFile
				break
			}
		}
	} else {
		bundle.Files = append(bundle.Files, manifestFile)
	}
	total += int64(len(manifestJSON))
	raw, err := json.Marshal(bundle)
	return string(raw), body, manifest, len(bundle.Files), total, err
}

// ReviewPersonalSkill rejects a pending submission or publishes it as a marketplace release.
func ReviewPersonalSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("无效技能 ID"))
		return
	}
	action := c.Param("action")
	personal, err := model.GetPersonalSkillById(id)
	if err != nil {
		skillError(c, http.StatusNotFound, err)
		return
	}
	if personal.Visibility != model.PersonalSkillPublic || personal.ReviewStatus != model.PersonalSkillReviewPending {
		skillError(c, http.StatusBadRequest, fmt.Errorf("该技能当前不在待审核状态"))
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&input)
	now := time.Now().Unix()
	reviewer := c.GetString(ctxkey.Username)
	if action == "reject" {
		input.Reason = strings.TrimSpace(input.Reason)
		if input.Reason == "" {
			skillError(c, http.StatusBadRequest, fmt.Errorf("请填写驳回原因"))
			return
		}
		personal.ReviewStatus = model.PersonalSkillReviewRejected
		personal.ReviewReason = input.Reason
		personal.ReviewedBy = reviewer
		personal.ReviewedAt = now
		if err := model.UpdatePersonalSkill(personal); err != nil {
			skillError(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "已驳回"})
		return
	}
	if action != "approve" {
		skillError(c, http.StatusBadRequest, fmt.Errorf("审核操作无效"))
		return
	}
	if err := validatePersonalSkillAssets(personal.Assets); err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("技能包无效：%w", err))
		return
	}
	bundle, body, metadata, fileCount, sizeBytes, err := communitySkillPackage(*personal)
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("技能包无效：%w", err))
		return
	}
	category, err := model.EnsurePrimarySkillCategory(metadata.Category)
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	metadata.Category = category
	tags, _ := json.Marshal(metadata.Tags)
	sha, err := model.SkillPackageSHA256(bundle)
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	publicSkillID := 0
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		var skill model.Skill
		if personal.PublishedSkillId == nil {
			sourceID := personal.Id
			skill = model.Skill{
				Name: metadata.Name, DisplayName: metadata.DisplayName, Icon: metadata.Icon, Category: category,
				Description: metadata.Description, Scenario: metadata.Summary, Content: body, Body: body,
				Assets: bundle, Submitter: personal.Owner, Source: model.SkillSourcePersonal, SourcePersonalSkillId: &sourceID,
				Tags: tags, Version: personal.Version, Status: 1, CreatedAt: now, UpdatedAt: now,
			}
			if err := tx.Create(&skill).Error; err != nil {
				return err
			}
		} else if err := tx.First(&skill, *personal.PublishedSkillId).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.SkillRelease{}).Where("skill_id = ? AND state = ?", skill.Id, model.SkillReleasePublished).Update("state", model.SkillReleaseArchived).Error; err != nil {
			return err
		}
		release := model.SkillRelease{SkillId: skill.Id, Version: personal.Version, State: model.SkillReleasePublished, Package: bundle, Body: body, Sha256: sha, FileCount: fileCount, SizeBytes: sizeBytes, CreatedBy: reviewer, ValidatedAt: now, PublishedAt: now}
		if err := tx.Create(&release).Error; err != nil {
			return err
		}
		applyPublishedSkillRelease(&skill, release, metadata, tags, now)
		skill.Icon = metadata.Icon
		skill.Submitter = personal.Owner
		skill.Source = model.SkillSourcePersonal
		sourceID := personal.Id
		skill.SourcePersonalSkillId = &sourceID
		if err := tx.Save(&skill).Error; err != nil {
			return err
		}
		publicSkillID = skill.Id
		return tx.Model(&model.PersonalSkill{}).Where("id = ?", personal.Id).Updates(map[string]interface{}{
			"review_status": model.PersonalSkillReviewApproved, "review_reason": "", "reviewed_by": reviewer,
			"reviewed_at": now, "published_skill_id": skill.Id, "published_version": personal.Version,
		}).Error
	})
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	if err := model.SyncPrimarySkillCategory(publicSkillID, category); err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	if err := model.RefreshSkillCache(); err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "审核通过，技能已发布"})
}
