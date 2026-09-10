package model

import "testing"

func TestIsUserPromptAuditQuestionFiltersFrameworkPrompts(t *testing.T) {
	for _, question := range []string{
		"",
		"Current runtime context. This snapshot supersedes earlier runtime-context snapshots.",
		"<system-reminder>internal instruction</system-reminder>",
		"<skill_content name=\"skill-upload-smoke-test\">\n# 技能上传链路测试",
		"<skill_resources>Base directory for this skill</skill_resources>",
		"<skill_instructions>执行技能流程</skill_instructions>",
		"# AGENTS.md instructions for the workspace",
		"## Skills\nA skill is a reusable set of task-specific instructions.",
	} {
		if IsUserPromptAuditQuestion(question) {
			t.Fatalf("framework prompt was accepted: %q", question)
		}
	}
	if !IsUserPromptAuditQuestion("请对这份数据进行分析") {
		t.Fatal("user question was rejected")
	}
}
