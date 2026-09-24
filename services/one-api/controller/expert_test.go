package controller

import (
	"encoding/json"
	"testing"
)

func TestDefaultExpertSections(t *testing.T) {
	for _, expert := range shippedExperts {
		var sections []struct {
			Title    string `json:"title"`
			Subtitle string `json:"subtitle"`
			Content  string `json:"content"`
		}
		if err := json.Unmarshal([]byte(defaultExpertSections(expert.Key)), &sections); err != nil {
			t.Fatalf("%s has invalid detail sections: %v", expert.Key, err)
		}
		if len(sections) != 4 {
			t.Fatalf("%s has %d detail sections, want 4", expert.Key, len(sections))
		}
		for _, section := range sections {
			if section.Title == "" || section.Subtitle == "" || section.Content == "" {
				t.Fatalf("%s has an incomplete detail section: %#v", expert.Key, section)
			}
		}
	}
}

func TestDisplayExpertSectionsUpgradesOnlyLegacyMeetingBlocks(t *testing.T) {
	profile := defaultExpertProfile("meeting-minutes")
	profile.DetailSections = `[{"title":"适用场景","subtitle":"场景应用","content":"管理员修改过的场景"},{"title":"需要准备的材料","subtitle":"材料要求","content":"管理员修改过的材料"},{"title":"本专家交付","subtitle":"输出内容","content":""},{"title":"处理原则","subtitle":"能力范围","content":"录音转写\n会议纪要\n行动事项"}]`
	var sections []struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(displayExpertSections(profile)), &sections); err != nil {
		t.Fatal(err)
	}
	if sections[0].Content != "管理员修改过的场景" || sections[1].Content != "管理员修改过的材料" || sections[2].Content == "" || sections[3].Content == "录音转写\n会议纪要\n行动事项" {
		t.Fatalf("legacy meeting sections were not selectively upgraded: %#v", sections)
	}
	profile.DetailSections = `[{"title":"适用场景","subtitle":"场景应用","content":"自定义1"},{"title":"需要准备的材料","subtitle":"材料要求","content":"自定义2"},{"title":"本专家交付","subtitle":"输出内容","content":"自定义3"},{"title":"处理原则","subtitle":"能力范围","content":"自定义4"}]`
	if displayExpertSections(profile) != profile.DetailSections {
		t.Fatal("administrator-authored sections must not be replaced")
	}
}

func TestMeetingMinutesExpertRoster(t *testing.T) {
	expert, ok := shippedExpert("meeting-minutes")
	if !ok {
		t.Fatal("meeting-minutes is missing from the shipped expert roster")
	}
	if expert.SkillKey != "office-meeting-minutes" {
		t.Fatalf("unexpected meeting skill: %q", expert.SkillKey)
	}
	profile := defaultExpertProfile(expert.Key)
	if profile.Name != "会议纪要专家" || profile.Icon != "meeting" {
		t.Fatalf("unexpected meeting profile: %#v", profile)
	}
	if profile.Published {
		t.Fatal("new expert profiles must remain unpublished until an administrator publishes them")
	}
}

func TestLandAnalysisExpertRoster(t *testing.T) {
	tests := []struct{ key, skill, name string }{
		{"third-survey-analysis", "market-gis-third-survey-analysis", "三调土地利用现状分析专家"},
		{"land-use-plan-review", "market-gis-land-use-plan-review", "土地利用规划审查专家"},
	}
	for _, test := range tests {
		expert, ok := shippedExpert(test.key)
		if !ok || expert.SkillKey != test.skill {
			t.Fatalf("unexpected shipped expert for %s: %#v", test.key, expert)
		}
		profile := defaultExpertProfile(test.key)
		if profile.Name != test.name || profile.Published {
			t.Fatalf("unexpected default profile for %s: %#v", test.key, profile)
		}
	}
}

func TestOfficeExpertRoster(t *testing.T) {
	tests := []struct{ key, skill, name string }{{"file-conversion-pdf", "office-word-to-pdf", "文件转换与 PDF 工具专家"}, {"document-intelligence", "office-document-summary", "文档智能处理专家"}}
	for _, test := range tests {
		expert, ok := shippedExpert(test.key)
		if !ok || expert.SkillKey != test.skill {
			t.Fatalf("unexpected roster entry %s: %#v", test.key, expert)
		}
		profile := defaultExpertProfile(test.key)
		if profile.Name != test.name || profile.Published {
			t.Fatalf("unexpected profile %s: %#v", test.key, profile)
		}
	}
}
