package main

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path"

	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

// officialSkillFS contains the three server-managed GIS skill packages. The
// server start creates missing records and refreshes the bundled package of
// existing records. Publish and deletion state remain owned by administrators.
//
//go:embed all:web/air/public/skills
var officialSkillFS embed.FS

type officialSkillCatalog struct {
	Skills []officialSkillManifest `json:"skills"`
}

type officialSkillManifest struct {
	Slug        string   `json:"slug"`
	DisplayName string   `json:"displayName"`
	Category    string   `json:"category"`
	Summary     string   `json:"summary"`
	Description string   `json:"description"`
	Version     string   `json:"version"`
	Author      string   `json:"author"`
	Tags        []string `json:"tags"`
	Status      string   `json:"status"`
	Files       []string `json:"files"`
}

type officialSkillBundle struct {
	SchemaVersion int                       `json:"schemaVersion"`
	Files         []officialSkillBundleFile `json:"files"`
}

type officialSkillBundleFile struct {
	Path          string `json:"path"`
	ContentBase64 string `json:"contentBase64"`
}

func seedBundledOfficialSkills() error {
	catalogSource, err := officialSkillFS.ReadFile("web/air/public/skills/catalog.json")
	if err != nil {
		return fmt.Errorf("读取内置技能目录失败: %w", err)
	}
	var catalog officialSkillCatalog
	if err := json.Unmarshal(catalogSource, &catalog); err != nil {
		return fmt.Errorf("内置技能目录格式无效: %w", err)
	}
	for _, manifest := range catalog.Skills {
		if manifest.Slug == "" || len(manifest.Files) == 0 {
			return fmt.Errorf("内置技能清单不完整: %s", manifest.Slug)
		}
		bundle := officialSkillBundle{SchemaVersion: 1, Files: make([]officialSkillBundleFile, 0, len(manifest.Files))}
		var body string
		for _, relative := range manifest.Files {
			if relative == "" || path.IsAbs(relative) || path.Clean(relative) != relative || relative == "." {
				return fmt.Errorf("内置技能 %s 包含不安全路径 %q", manifest.Slug, relative)
			}
			content, err := officialSkillFS.ReadFile(path.Join("web/air/public/skills", manifest.Slug, relative))
			if err != nil {
				return fmt.Errorf("读取内置技能 %s 的 %s 失败: %w", manifest.Slug, relative, err)
			}
			if relative == "SKILL.md" {
				body = string(content)
			}
			bundle.Files = append(bundle.Files, officialSkillBundleFile{Path: relative, ContentBase64: base64.StdEncoding.EncodeToString(content)})
		}
		if body == "" {
			return fmt.Errorf("内置技能 %s 缺少 SKILL.md", manifest.Slug)
		}
		assets, err := json.Marshal(bundle)
		if err != nil {
			return fmt.Errorf("编码内置技能 %s 失败: %w", manifest.Slug, err)
		}
		status := 0
		if manifest.Status == "published" {
			status = 1
		}
		tags, err := json.Marshal(manifest.Tags)
		if err != nil {
			return fmt.Errorf("编码内置技能 %s 标签失败: %w", manifest.Slug, err)
		}
		existing, err := model.GetSkillByNameAny(manifest.Slug)
		if err == nil && existing != nil {
			existing.Content = body
			existing.Body = body
			existing.Assets = string(assets)
			existing.Version = manifest.Version
			existing.DisplayName = manifest.DisplayName
			existing.Category = manifest.Category
			existing.Description = manifest.Description
			existing.Scenario = manifest.Summary
			existing.Submitter = manifest.Author
			existing.Tags = tags
			if err := model.UpdateSkill(existing); err != nil {
				return fmt.Errorf("更新内置技能 %s 失败: %w", manifest.Slug, err)
			}
			continue
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("查询内置技能 %s 失败: %w", manifest.Slug, err)
		}
		skill := model.Skill{
			Name:        manifest.Slug,
			DisplayName: manifest.DisplayName,
			Category:    manifest.Category,
			Description: manifest.Description,
			Scenario:    manifest.Summary,
			Content:     body,
			Body:        body,
			Assets:      string(assets),
			Submitter:   manifest.Author,
			Tags:        tags,
			Version:     manifest.Version,
			Status:      status,
		}
		if err := model.CreateSkill(&skill); err != nil {
			return fmt.Errorf("创建内置技能 %s 失败: %w", manifest.Slug, err)
		}
	}
	return nil
}
