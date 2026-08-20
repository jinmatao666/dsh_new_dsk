package controller

import (
	"testing"

	"github.com/songquanpeng/one-api/model"
)

// 验证客户端模型下发契约:仅下发在 model_definitions 登记、启用、且为 chat 类型的模型;
// 渠道(ability)里有但未登记的模型一律不下发(回归保护:历史上未登记模型会绕过过滤冒出来)。
func TestBuildClientModelDetails(t *testing.T) {
	names := []string{
		"qwen3-plus",                 // 登记 + 启用 + chat → 下发(带 DisplayName)
		"qwen-vl",                    // 登记 + 启用 + other → 过滤
		"disabled-model",             // 登记 + 停用 → 过滤
		"channel-only",               // 未登记(渠道里有)→ 过滤
		"Pro/MiniMaxAI/MiniMax-M2.5", // 未登记 → 过滤
	}
	defs := map[string]*model.ModelDefinition{
		"qwen3-plus": {
			Name:        "qwen3-plus",
			DisplayName: "Qwen3 Plus",
			Enabled:     true,
			ModelType:   model.ModelTypeChat,
			Reasoning:   true,
			ToolCall:    true,
			Modalities:  "text,image",
		},
		"qwen-vl": {
			Name:      "qwen-vl",
			Enabled:   true,
			ModelType: model.ModelTypeOther,
		},
		"disabled-model": {
			Name:      "disabled-model",
			Enabled:   false,
			ModelType: model.ModelTypeChat,
		},
	}

	result := buildClientModelDetails(names, defs)

	if len(result) != 1 {
		t.Fatalf("期望仅下发 1 个模型,实际 %d 个: %+v", len(result), result)
	}
	got := result[0]
	if got.Id != "qwen3-plus" {
		t.Errorf("Id 期望 qwen3-plus,实际 %s", got.Id)
	}
	if got.Name != "Qwen3 Plus" {
		t.Errorf("Name 应取 DisplayName,期望 Qwen3 Plus,实际 %s", got.Name)
	}
	if !got.Reasoning {
		t.Errorf("Reasoning 应为 true")
	}
	if len(got.Modalities.Input) != 2 || got.Modalities.Input[0] != "text" || got.Modalities.Input[1] != "image" {
		t.Errorf("Modalities.Input 期望 [text image],实际 %v", got.Modalities.Input)
	}
}

// 空 ModelType 视为 chat(兼容历史数据:早期登记的模型 model_type 可能为空)。
func TestBuildClientModelDetails_EmptyModelTypeIsChat(t *testing.T) {
	names := []string{"legacy"}
	defs := map[string]*model.ModelDefinition{
		"legacy": {Name: "legacy", Enabled: true, ModelType: ""},
	}
	result := buildClientModelDetails(names, defs)
	if len(result) != 1 {
		t.Fatalf("空 ModelType 应视为 chat 并下发,实际下发 %d 个", len(result))
	}
}

// 全部未登记时下发空列表(而非 nil),保证 JSON 序列化为 [] 而非 null。
func TestBuildClientModelDetails_AllUnregistered(t *testing.T) {
	names := []string{"a", "b"}
	result := buildClientModelDetails(names, map[string]*model.ModelDefinition{})
	if result == nil {
		t.Fatalf("期望非 nil 空切片")
	}
	if len(result) != 0 {
		t.Fatalf("期望空列表,实际 %d 个", len(result))
	}
}

// 同 sort 时按 id 升序(= 后台 "sort asc, id asc"),不按名称。
// 回归:Auto(id=20,sort=0) 与 000(id=27,sort=0) 同 sort,名称字母序会让 000 排前面,
// 与后台显示顺序(Auto 在上)相反——必须用 id 兜底。
func TestSortModelNames(t *testing.T) {
	defs := map[string]*model.ModelDefinition{
		"qwen3.7-plus#auto": {Id: 20, Name: "qwen3.7-plus#auto", Sort: 0},
		"qwen3.7-max":       {Id: 27, Name: "qwen3.7-max", Sort: 0},
		"qwen3.6-plus":      {Id: 11, Name: "qwen3.6-plus", Sort: 1},
		"glm-5":             {Id: 2, Name: "glm-5", Sort: 5},
	}
	// 故意打乱传入顺序 + 混入一个未登记模型
	names := []string{"glm-5", "qwen3.7-max", "channel-only", "qwen3.6-plus", "qwen3.7-plus#auto"}
	sortModelNames(names, defs)

	want := []string{"qwen3.7-plus#auto", "qwen3.7-max", "qwen3.6-plus", "glm-5", "channel-only"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("排序结果不符\n期望: %v\n实际: %v", want, names)
		}
	}
}
