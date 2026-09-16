package controller

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/songquanpeng/one-api/model"
)

func TestNextPersonalSkillVersion(t *testing.T) {
	if got := nextPersonalSkillVersion("1.0.0", "1.0.0"); got != "1.0.1" {
		t.Fatalf("approved version update = %q", got)
	}
	if got := nextPersonalSkillVersion("1.0.1", "1.0.0"); got != "1.0.1" {
		t.Fatalf("pending version update = %q", got)
	}
}

func TestCommunitySkillPackageUsesStableInternalName(t *testing.T) {
	source := "---\nname: user-chosen-name\ndescription: test\n---\n\n# Test\n"
	bundle, err := json.Marshal(skillPackage{SchemaVersion: 1, Files: []skillPackageFile{{
		Path: "SKILL.md", ContentBase64: base64.StdEncoding.EncodeToString([]byte(source)),
	}}})
	if err != nil {
		t.Fatal(err)
	}
	assets, body, manifest, _, _, err := communitySkillPackage(model.PersonalSkill{
		Id: 42, Name: "user-chosen-name", DisplayName: "允许重复的显示名称", Version: "1.0.0",
		Category: "通用类", Description: "test", Owner: "alice", Assets: string(bundle),
	})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Name != "community-42" || manifest.DisplayName != "允许重复的显示名称" {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
	if !strings.Contains(body, "name: community-42") || strings.Contains(body, "name: user-chosen-name") {
		t.Fatalf("SKILL.md internal name was not rewritten: %s", body)
	}
	if err := validatePersonalSkillAssets(assets); err != nil {
		t.Fatalf("published package is invalid: %v", err)
	}
}
