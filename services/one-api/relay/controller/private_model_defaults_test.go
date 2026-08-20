package controller

import (
	"testing"

	"github.com/songquanpeng/one-api/relay/model"
)

func TestApplyPrivateModelDefaults(t *testing.T) {
	request := &model.GeneralOpenAIRequest{}
	if !applyPrivateModelDefaults("qwen3.6-plus", request) {
		t.Fatal("expected qwen3.6-plus to require request conversion")
	}
	if value, ok := request.ChatTemplateKwargs["enable_thinking"]; !ok || value != false {
		t.Fatalf("expected enable_thinking=false, got %#v", request.ChatTemplateKwargs)
	}

	explicit := &model.GeneralOpenAIRequest{
		ChatTemplateKwargs: map[string]any{"enable_thinking": true},
	}
	applyPrivateModelDefaults("qwen3.6-plus", explicit)
	if explicit.ChatTemplateKwargs["enable_thinking"] != true {
		t.Fatal("explicit caller setting must be preserved")
	}

	other := &model.GeneralOpenAIRequest{}
	if applyPrivateModelDefaults("qwen3-235b", other) || other.ChatTemplateKwargs != nil {
		t.Fatal("other models must remain unchanged")
	}
}
