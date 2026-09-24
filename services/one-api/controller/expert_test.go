package controller

import "testing"

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
