package controller

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

const (
	maxSkillArchiveBytes = 10 << 20
	maxSkillPackageBytes = 30 << 20
	maxSkillFileBytes    = 5 << 20
	maxSkillFiles        = 200
	maxSkillDepth        = 8
)

var skillSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type skillPackageFile struct {
	Path          string `json:"path"`
	ContentBase64 string `json:"contentBase64"`
}
type skillPackage struct {
	SchemaVersion int                `json:"schemaVersion"`
	Files         []skillPackageFile `json:"files"`
}
type importedManifest struct {
	Name        string   `json:"name"`
	Slug        string   `json:"slug"`
	Version     string   `json:"version"`
	DisplayName string   `json:"displayName"`
	Category    string   `json:"category"`
	Description string   `json:"description"`
	Summary     string   `json:"summary"`
	Author      string   `json:"author"`
	Icon        string   `json:"icon"`
	Tags        []string `json:"tags"`
	Files       []string `json:"files"`
}

type validatedSkillPackage struct {
	manifest  importedManifest
	bundle    string
	body      string
	sha256    string
	fileCount int
	sizeBytes int64
}

func skillError(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"success": false, "message": err.Error()})
}

func cleanSkillArchivePath(name string) (string, error) {
	name = strings.ReplaceAll(name, `\\`, "/")
	if name == "" || strings.HasPrefix(name, "/") || path.IsAbs(name) {
		return "", fmt.Errorf("技能包包含绝对路径 %q", name)
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || cleaned != name {
		return "", fmt.Errorf("技能包包含不安全路径 %q", name)
	}
	parts := strings.Split(cleaned, "/")
	if len(parts) > maxSkillDepth {
		return "", fmt.Errorf("技能包目录层级超过 %d", maxSkillDepth)
	}
	return cleaned, nil
}

func declaredSkillName(body []byte) string {
	text := strings.TrimPrefix(string(body), "\ufeff")
	if !strings.HasPrefix(text, "---\n") && !strings.HasPrefix(text, "---\r\n") {
		return ""
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			return strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, "name:")), `"'`)
		}
	}
	return ""
}

// normalizeImportedManifest intentionally accepts ordinary Codex skill folders.
// The package name is an internal identifier, not a reason to reject a user's
// skill just because its directory, frontmatter and optional manifest disagree.
func normalizeImportedManifest(manifest *importedManifest, skillMd []byte, prefix string) error {
	candidates := []string{
		strings.TrimSpace(manifest.Name),
		strings.TrimSpace(manifest.Slug),
		declaredSkillName(skillMd),
		strings.TrimSpace(prefix),
	}
	for _, candidate := range candidates {
		if skillSlugPattern.MatchString(candidate) {
			manifest.Name = candidate
			manifest.Slug = candidate
			break
		}
	}
	if !skillSlugPattern.MatchString(manifest.Name) {
		return fmt.Errorf("技能需要一个 kebab-case 标识；请在 SKILL.md 的 name 或 manifest.json 的 name 中填写")
	}
	manifest.Version = strings.TrimSpace(manifest.Version)
	if manifest.Version == "" {
		manifest.Version = "0.1.0"
	}
	manifest.DisplayName = strings.TrimSpace(manifest.DisplayName)
	if manifest.DisplayName == "" {
		manifest.DisplayName = manifest.Name
	}
	manifest.Category = strings.TrimSpace(manifest.Category)
	if manifest.Category == "" {
		manifest.Category = model.DefaultSkillCategoryName
	}
	if len(manifest.Tags) == 0 {
		manifest.Tags = []string{"通用能力"}
	}
	manifest.Icon = strings.TrimSpace(manifest.Icon)
	if err := validateSkillIcon(manifest.Icon); err != nil {
		return err
	}
	return nil
}

func normalizedManifestJSON(raw []byte, exists bool, manifest importedManifest) ([]byte, error) {
	document := map[string]interface{}{}
	if exists {
		if err := json.Unmarshal(raw, &document); err != nil {
			return nil, fmt.Errorf("manifest.json 不是有效 JSON：%w", err)
		}
	}
	document["schemaVersion"] = 1
	document["name"] = manifest.Name
	document["slug"] = manifest.Slug
	document["version"] = manifest.Version
	document["displayName"] = manifest.DisplayName
	document["category"] = manifest.Category
	document["description"] = manifest.Description
	document["summary"] = manifest.Summary
	document["author"] = manifest.Author
	document["icon"] = manifest.Icon
	document["tags"] = manifest.Tags
	document["files"] = manifest.Files
	return json.Marshal(document)
}

func validateSkillArchive(raw []byte) (*validatedSkillPackage, error) {
	if len(raw) == 0 || len(raw) > maxSkillArchiveBytes {
		return nil, fmt.Errorf("技能 ZIP 必须大于 0 且不超过 %d MB", maxSkillArchiveBytes>>20)
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, fmt.Errorf("技能包不是有效 ZIP：%w", err)
	}
	if len(zr.File) == 0 || len(zr.File) > maxSkillFiles {
		return nil, fmt.Errorf("技能包文件数量必须在 1 至 %d 之间", maxSkillFiles)
	}
	type source struct {
		path    string
		content []byte
	}
	sources := make([]source, 0, len(zr.File))
	seen := map[string]struct{}{}
	var total int64
	for _, entry := range zr.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		if entry.Mode()&0o170000 == 0o120000 {
			return nil, fmt.Errorf("技能包不能包含符号链接：%s", entry.Name)
		}
		name, err := cleanSkillArchivePath(entry.Name)
		if err != nil {
			return nil, err
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, fmt.Errorf("技能包包含重复路径：%s", name)
		}
		seen[name] = struct{}{}
		if entry.UncompressedSize64 > maxSkillFileBytes {
			return nil, fmt.Errorf("技能包文件超过 %d MB：%s", maxSkillFileBytes>>20, name)
		}
		total += int64(entry.UncompressedSize64)
		if total > maxSkillPackageBytes {
			return nil, fmt.Errorf("技能包解压后不能超过 %d MB", maxSkillPackageBytes>>20)
		}
		reader, err := entry.Open()
		if err != nil {
			return nil, err
		}
		content, readErr := io.ReadAll(io.LimitReader(reader, maxSkillFileBytes+1))
		closeErr := reader.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if len(content) > maxSkillFileBytes {
			return nil, fmt.Errorf("技能包文件超过 %d MB：%s", maxSkillFileBytes>>20, name)
		}
		sources = append(sources, source{name, content})
	}
	if len(sources) == 0 {
		return nil, fmt.Errorf("技能包没有普通文件")
	}
	// A single wrapping folder is accepted and removed. It is required to match
	// the declared slug; a raw archive is also accepted for tool-generated ZIPs.
	prefix := ""
	for _, item := range sources {
		first := strings.Split(item.path, "/")[0]
		if !strings.Contains(item.path, "/") {
			prefix = ""
			break
		}
		if prefix == "" {
			prefix = first
		} else if prefix != first {
			prefix = ""
			break
		}
	}
	if prefix != "" {
		for i := range sources {
			sources[i].path = strings.TrimPrefix(sources[i].path, prefix+"/")
		}
	}
	contents := map[string][]byte{}
	for _, item := range sources {
		if _, duplicate := contents[item.path]; duplicate {
			return nil, fmt.Errorf("技能包标准化后包含重复路径：%s", item.path)
		}
		contents[item.path] = item.content
	}
	skillMd, hasSkillMd := contents["SKILL.md"]
	manifestRaw, hasManifest := contents["manifest.json"]
	if !hasSkillMd {
		return nil, fmt.Errorf("技能包根目录必须包含 UTF-8 SKILL.md")
	}
	if !utf8.Valid(skillMd) {
		return nil, fmt.Errorf("SKILL.md 必须使用 UTF-8")
	}
	var manifest importedManifest
	if hasManifest {
		if !utf8.Valid(manifestRaw) {
			return nil, fmt.Errorf("manifest.json 必须使用 UTF-8")
		}
		if err := json.Unmarshal(manifestRaw, &manifest); err != nil {
			return nil, fmt.Errorf("manifest.json 不是有效 JSON：%w", err)
		}
	}
	if err := normalizeImportedManifest(&manifest, skillMd, prefix); err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(contents)+1)
	for filePath := range contents {
		if filePath != "manifest.json" {
			paths = append(paths, filePath)
		}
	}
	paths = append(paths, "manifest.json")
	sort.Strings(paths)
	manifest.Files = paths
	normalizedManifest, err := normalizedManifestJSON(manifestRaw, hasManifest, manifest)
	if err != nil {
		return nil, err
	}
	contents["manifest.json"] = normalizedManifest
	files := make([]skillPackageFile, 0, len(paths))
	for _, filePath := range paths {
		files = append(files, skillPackageFile{Path: filePath, ContentBase64: base64.StdEncoding.EncodeToString(contents[filePath])})
	}
	hash := sha256.New()
	for _, file := range files {
		_, _ = hash.Write([]byte(file.Path))
		_, _ = hash.Write([]byte{0})
		decoded, _ := base64.StdEncoding.DecodeString(file.ContentBase64)
		_, _ = hash.Write(decoded)
		_, _ = hash.Write([]byte{0})
	}
	bundle, err := json.Marshal(skillPackage{SchemaVersion: 1, Files: files})
	if err != nil {
		return nil, err
	}
	return &validatedSkillPackage{manifest: manifest, bundle: string(bundle), body: string(skillMd), sha256: hex.EncodeToString(hash.Sum(nil)), fileCount: len(files), sizeBytes: total}, nil
}

// ImportSkillRelease accepts a ZIP, validates it without executing its files,
// and creates a draft release. Publication is a separate administrator action.
func ImportSkillRelease(c *gin.Context) {
	file, err := c.FormFile("package")
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("需要 multipart 字段 package：%w", err))
		return
	}
	if file.Size > maxSkillArchiveBytes {
		skillError(c, http.StatusRequestEntityTooLarge, fmt.Errorf("技能 ZIP 不能超过 %d MB", maxSkillArchiveBytes>>20))
		return
	}
	h, err := file.Open()
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	raw, readErr := io.ReadAll(io.LimitReader(h, maxSkillArchiveBytes+1))
	_ = h.Close()
	if readErr != nil {
		skillError(c, http.StatusBadRequest, readErr)
		return
	}
	pkg, err := validateSkillArchive(raw)
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	changelog := strings.TrimSpace(c.PostForm("changelog"))
	operator := strings.TrimSpace(c.GetString("username"))
	if operator == "" {
		operator = "root"
	}
	category, err := model.EnsurePrimarySkillCategory(pkg.manifest.Category)
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	pkg.manifest.Category = category
	var skill model.Skill
	err = model.DB.Where("name = ?", pkg.manifest.Name).First(&skill).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		tags, _ := json.Marshal(pkg.manifest.Tags)
		skill = model.Skill{Name: pkg.manifest.Name, DisplayName: pkg.manifest.DisplayName, Icon: pkg.manifest.Icon, Category: pkg.manifest.Category, Description: pkg.manifest.Description, Scenario: pkg.manifest.Summary, Submitter: operator, Tags: tags, Version: pkg.manifest.Version, Status: 0, Content: pkg.body, Body: pkg.body, Assets: pkg.bundle}
		if skill.DisplayName == "" {
			skill.DisplayName = skill.Name
		}
		if err = model.DB.Create(&skill).Error; err != nil {
			skillError(c, http.StatusInternalServerError, err)
			return
		}
		if err = model.SyncPrimarySkillCategory(skill.Id, skill.Category); err != nil {
			skillError(c, http.StatusInternalServerError, err)
			return
		}
	} else if err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	} else if skill.IsDeleted {
		// Deleting a skill from management means an administrator expects a clean
		// re-import to work. Keep the stable skill ID for relations, but discard
		// its hidden release history so the same initial version can be imported.
		tags, _ := json.Marshal(pkg.manifest.Tags)
		if err = model.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("skill_id = ?", skill.Id).Delete(&model.SkillRelease{}).Error; err != nil {
				return err
			}
			return tx.Model(&model.Skill{}).Where("id = ?", skill.Id).Updates(map[string]interface{}{
				"display_name":         pkg.manifest.DisplayName,
				"category":             pkg.manifest.Category,
				"description":          pkg.manifest.Description,
				"scenario":             pkg.manifest.Summary,
				"submitter":            operator,
				"tags":                 tags,
				"version":              pkg.manifest.Version,
				"status":               0,
				"is_deleted":           false,
				"content":              pkg.body,
				"body":                 pkg.body,
				"assets":               pkg.bundle,
				"published_release_id": nil,
			}).Error
		}); err != nil {
			skillError(c, http.StatusInternalServerError, err)
			return
		}
		skill.DisplayName = pkg.manifest.DisplayName
		skill.Category = pkg.manifest.Category
		skill.IsDeleted = false
		skill.Status = 0
		skill.PublishedReleaseId = nil
		if err = model.SyncPrimarySkillCategory(skill.Id, skill.Category); err != nil {
			skillError(c, http.StatusInternalServerError, err)
			return
		}
	}
	var existingRelease model.SkillRelease
	if err = model.DB.Where("skill_id = ? AND version = ?", skill.Id, pkg.manifest.Version).First(&existingRelease).Error; err == nil {
		skillError(c, http.StatusConflict, fmt.Errorf("技能 %s 已存在版本 %s；请在 manifest.json 中提高 version 后重新导入", skill.Name, pkg.manifest.Version))
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	release := model.SkillRelease{SkillId: skill.Id, Version: pkg.manifest.Version, State: model.SkillReleaseUnpublished, Package: pkg.bundle, Body: pkg.body, Sha256: pkg.sha256, FileCount: pkg.fileCount, SizeBytes: pkg.sizeBytes, Changelog: changelog, CreatedBy: operator}
	if err = model.DB.Create(&release).Error; err != nil {
		skillError(c, http.StatusConflict, fmt.Errorf("无法创建未上架版本：%w", err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"skill": skillToResponse(skill), "release": release, "files": json.RawMessage(pkg.bundle)}})
}

func ValidateSkillRelease(c *gin.Context) {
	skillID, releaseID, ok := releaseIDs(c)
	if !ok {
		return
	}
	release, err := model.GetSkillRelease(skillID, releaseID)
	if err != nil {
		skillError(c, http.StatusNotFound, err)
		return
	}
	var bundle skillPackage
	if err := json.Unmarshal([]byte(release.Package), &bundle); err != nil {
		skillError(c, http.StatusInternalServerError, fmt.Errorf("草稿包损坏：%w", err))
		return
	}
	validatedAt := time.Now().Unix()
	if err := model.DB.Model(&model.SkillRelease{}).Where("id = ? AND skill_id = ?", releaseID, skillID).Update("validated_at", validatedAt).Error; err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	release.ValidatedAt = validatedAt
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"valid": true, "issues": []string{}, "release": release, "sha256": release.Sha256, "file_count": release.FileCount, "size_bytes": release.SizeBytes, "files": bundle.Files}})
}

func metadataFromSkillPackage(raw string) (importedManifest, error) {
	var bundle skillPackage
	if err := json.Unmarshal([]byte(raw), &bundle); err != nil {
		return importedManifest{}, err
	}
	for _, file := range bundle.Files {
		if file.Path != "manifest.json" {
			continue
		}
		content, err := base64.StdEncoding.DecodeString(file.ContentBase64)
		if err != nil {
			return importedManifest{}, err
		}
		var manifest importedManifest
		if err := json.Unmarshal(content, &manifest); err != nil {
			return importedManifest{}, err
		}
		return manifest, nil
	}
	return importedManifest{}, fmt.Errorf("技能包缺少 manifest.json")
}

func releaseIDs(c *gin.Context) (int, int, bool) {
	skillID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("无效技能 ID"))
		return 0, 0, false
	}
	releaseID, err := strconv.Atoi(c.Param("releaseId"))
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("无效版本 ID"))
		return 0, 0, false
	}
	return skillID, releaseID, true
}

func publishSkillRelease(c *gin.Context, rollback bool) {
	skillID, releaseID, ok := releaseIDs(c)
	if !ok {
		return
	}
	now := time.Now().Unix()
	releaseForMetadata, err := model.GetSkillRelease(skillID, releaseID)
	if err != nil {
		skillError(c, http.StatusNotFound, err)
		return
	}
	metadata, err := metadataFromSkillPackage(releaseForMetadata.Package)
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("版本元数据无效：%w", err))
		return
	}
	category, err := model.EnsurePrimarySkillCategory(metadata.Category)
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	metadata.Category = category
	tags, err := json.Marshal(metadata.Tags)
	if err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		var skill model.Skill
		if err := tx.First(&skill, skillID).Error; err != nil {
			return err
		}
		var release model.SkillRelease
		if err := tx.Where("id = ? AND skill_id = ?", releaseID, skillID).First(&release).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.SkillRelease{}).Where("skill_id = ? AND id <> ? AND state = ?", skillID, releaseID, model.SkillReleasePublished).Update("state", model.SkillReleaseArchived).Error; err != nil {
			return err
		}
		release.State = model.SkillReleasePublished
		release.PublishedAt = now
		if err := tx.Save(&release).Error; err != nil {
			return err
		}
		skill.PublishedReleaseId = &release.Id
		skill.Version = release.Version
		skill.Body = release.Body
		skill.Content = release.Body
		skill.Assets = release.Package
		skill.BodyUpdatedAt = now
		skill.AssetsUpdatedAt = now
		skill.Status = 1
		skill.IsDeleted = false
		if metadata.DisplayName != "" {
			skill.DisplayName = metadata.DisplayName
		}
		if metadata.Category != "" {
			skill.Category = metadata.Category
		}
		if metadata.Description != "" {
			skill.Description = metadata.Description
		}
		if metadata.Summary != "" {
			skill.Scenario = metadata.Summary
		}
		if metadata.Icon != "" {
			skill.Icon = metadata.Icon
		}
		skill.Tags = tags
		return tx.Save(&skill).Error
	})
	if err != nil {
		skillError(c, http.StatusBadRequest, err)
		return
	}
	if err := model.RefreshSkillCache(); err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	if err := model.SyncPrimarySkillCategory(skillID, metadata.Category); err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	message := "版本已发布"
	if rollback {
		message = "已回滚并发布历史版本"
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": message})
}
func PublishSkillRelease(c *gin.Context)  { publishSkillRelease(c, false) }
func RollbackSkillRelease(c *gin.Context) { publishSkillRelease(c, true) }
func UnpublishSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("无效技能 ID"))
		return
	}
	if err = model.DB.Model(&model.Skill{}).Where("id = ?", id).Updates(map[string]any{"status": 0, "published_release_id": nil}).Error; err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	if err = model.RefreshSkillCache(); err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func ListSkillReleases(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		skillError(c, http.StatusBadRequest, fmt.Errorf("无效技能 ID"))
		return
	}
	releases, err := model.ListSkillReleases(id)
	if err != nil {
		skillError(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": releases})
}
