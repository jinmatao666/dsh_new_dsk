package controller

import (
	"testing"

	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"github.com/stretchr/testify/require"
)

func TestLatestUserQuestionSupportsResponsesInputText(t *testing.T) {
	request := &relaymodel.GeneralOpenAIRequest{
		Messages: []relaymodel.Message{
			{Role: "system", Content: "system instruction"},
			{Role: "user", Content: []any{
				map[string]any{"type": "input_text", "text": "新会话的第一条问题"},
			}},
		},
	}

	require.Equal(t, "新会话的第一条问题", latestUserQuestion(request))
}

func TestLatestUserQuestionKeepsLatestUserText(t *testing.T) {
	request := &relaymodel.GeneralOpenAIRequest{
		Messages: []relaymodel.Message{
			{Role: "user", Content: "旧问题"},
			{Role: "assistant", Content: "旧回答"},
			{Role: "user", Content: []any{
				map[string]any{"type": "input_text", "text": "最新问题"},
				map[string]any{"type": "input_image", "image_url": "ignored"},
			}},
		},
	}

	require.Equal(t, "最新问题", latestUserQuestion(request))
}

func TestLatestUserQuestionSkipsRuntimeContextSnapshot(t *testing.T) {
	request := &relaymodel.GeneralOpenAIRequest{
		Messages: []relaymodel.Message{
			{Role: "user", Content: "请分析地块范围"},
			{Role: "user", Content: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots."},
		},
	}

	require.Equal(t, "请分析地块范围", latestUserQuestion(request))
}

func TestLatestUserQuestionSkipsSkillContent(t *testing.T) {
	request := &relaymodel.GeneralOpenAIRequest{
		Messages: []relaymodel.Message{
			{Role: "user", Content: "请验证刚安装的技能"},
			{Role: "user", Content: "<skill_content name=\"skill-upload-smoke-test\">\n<skill_resources>Base directory for this skill</skill_resources>\n<skill_instructions># 执行</skill_instructions>"},
		},
	}

	require.Equal(t, "请验证刚安装的技能", latestUserQuestion(request))
}
