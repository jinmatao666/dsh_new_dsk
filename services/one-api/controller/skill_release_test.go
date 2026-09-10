package controller

import (
	"archive/zip"
	"bytes"
	"testing"
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

func TestValidateSkillArchiveRejectsPathEscapeAndNameMismatch(t *testing.T) {
	_, err := validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"../SKILL.md":   "---\nname: bad\n---\n",
		"manifest.json": `{"name":"bad","version":"1.0.0","files":["SKILL.md","manifest.json"]}`,
	}))
	if err == nil {
		t.Fatal("expected path escape rejection")
	}

	_, err = validateSkillArchive(skillArchiveForTest(t, map[string]string{
		"SKILL.md":      "---\nname: another-skill\n---\n",
		"manifest.json": `{"name":"example-skill","version":"1.0.0","files":["SKILL.md","manifest.json"]}`,
	}))
	if err == nil {
		t.Fatal("expected name mismatch rejection")
	}
}
