package controller

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"testing"

	"github.com/songquanpeng/one-api/model"
)

func skillArchiveForTest(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestValidateSkillArchiveAcceptsCompletePackage(t *testing.T) {
	manifest := `{"name":"example-skill","slug":"example-skill","version":"1.0.0","files":["SKILL.md","manifest.json","scripts/run.ps1"]}`
	pkg, err := validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"example-skill/SKILL.md":        "---\nname: example-skill\n---\n# Example\n",
		"example-skill/manifest.json":   manifest,
		"example-skill/scripts/run.ps1": "Write-Output example\n",
	}))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if pkg.manifest.Name != "example-skill" || pkg.fileCount != 3 || pkg.sha256 == "" {
		t.Fatalf("unexpected package: %#v", pkg)
	}
}

func TestValidateSkillArchiveCarriesManifestIcon(t *testing.T) {
	manifest := `{"name":"icon-skill","slug":"icon-skill","version":"1.0.0","icon":"glyph:chart"}`
	pkg, err := validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"SKILL.md":      "---\nname: icon-skill\n---\n# Icon\n",
		"manifest.json": manifest,
	}))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if pkg.manifest.Icon != "glyph:chart" {
		t.Fatalf("icon not retained: %#v", pkg.manifest)
	}
}

func TestValidateSkillArchiveUsesDefaultForTextIcon(t *testing.T) {
	manifest := `{"name":"icon-skill","version":"1.0.0","icon":"W"}`
	pkg, err := validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"SKILL.md":      "---\nname: icon-skill\n---\n# Icon\n",
		"manifest.json": manifest,
	}))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if pkg.manifest.Icon != "glyph:bot" {
		t.Fatalf("unexpected normalized icon: %q", pkg.manifest.Icon)
	}
}

func TestValidateSkillArchiveNormalizesManagerFriendlyPackage(t *testing.T) {
	pkg, err := validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"中文办公技能/skill.md":  "---\nname: Word 转 PDF\n---\n# Word 转 PDF\n",
		"中文办公技能/.DS_Store": "ignored",
	}))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if pkg.manifest.Name != "word-pdf" || pkg.manifest.DisplayName != "Word 转 PDF" {
		t.Fatalf("unexpected manifest: %#v", pkg.manifest)
	}
	if pkg.fileCount != 2 {
		t.Fatalf("unexpected file count: %d", pkg.fileCount)
	}
}

func TestValidateSkillArchiveRejectsPathEscapeAndAcceptsNameMismatch(t *testing.T) {
	_, err := validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"../SKILL.md":   "---\nname: bad\n---\n",
		"manifest.json": `{"name":"bad","version":"1.0.0","files":["SKILL.md","manifest.json"]}`,
	}))
	if err == nil {
		t.Fatal("expected path escape rejection")
	}

	pkg, err := validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"SKILL.md":      "---\nname: another-skill\n---\n",
		"manifest.json": `{"name":"example-skill","version":"1.0.0","files":["SKILL.md","manifest.json"]}`,
	}))
	if err != nil {
		t.Fatalf("validate mismatch: %v", err)
	}
	if pkg.manifest.Name != "example-skill" {
		t.Fatalf("unexpected normalized name: %q", pkg.manifest.Name)
	}
}

func TestApplyPublishedSkillReleasePreservesAdministratorIcon(t *testing.T) {
	skill := model.Skill{Icon: "data:image/png;base64,administrator-selected", Status: 0, IsDeleted: true}
	release := model.SkillRelease{Id: 12, Version: "2.0.0", Body: "updated body", Package: "updated package"}
	metadata := importedManifest{
		DisplayName: "Updated skill",
		Icon:        "glyph:bot",
		Category:    "通用办公",
		Description: "Updated description",
		Summary:     "Updated summary",
	}
	tags := json.RawMessage(`["updated"]`)

	applyPublishedSkillRelease(&skill, release, metadata, tags, 123)

	if skill.Icon != "data:image/png;base64,administrator-selected" {
		t.Fatalf("package publication replaced administrator icon: %q", skill.Icon)
	}
	if skill.PublishedReleaseId == nil || *skill.PublishedReleaseId != release.Id || skill.Version != release.Version || skill.Body != release.Body || skill.Assets != release.Package {
		t.Fatalf("release content was not applied: %#v", skill)
	}
}
