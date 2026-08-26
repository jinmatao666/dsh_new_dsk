package controller

import (
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

// 客户端模型同步(T5.1)
//
// 桌面端登录后拉取本接口,用返回的模型元数据动态生成 opencode provider.models,
// 替代编译期硬编码的 models.config.json。结构对齐 opencode 的 ModelsDev.Model。

type clientModelLimit struct {
	Context int `json:"context"`
	Output  int `json:"output"`
}

type clientModelModalities struct {
	Input  []string `json:"input"`
	Output []string `json:"output"`
}

// clientModelDetail 对齐 opencode ModelsDev.Model 的关键字段(packages/opencode/src/provider/models.ts)
type clientModelDetail struct {
	Id          string                `json:"id"`   // 真实模型名(渠道可识别)
	Name        string                `json:"name"` // 展示名
	Reasoning   bool                  `json:"reasoning"`
	Attachment  bool                  `json:"attachment"`
	ToolCall    bool                  `json:"tool_call"`
	Temperature bool                  `json:"temperature"`
	Modalities  clientModelModalities `json:"modalities"`
	Limit       clientModelLimit      `json:"limit"`
}

func clientModelInputs(def *model.ModelDefinition) []string {
	inputs := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	appendInput := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		inputs = append(inputs, value)
	}
	appendInput("text")
	for _, value := range strings.Split(def.Modalities, ",") {
		appendInput(value)
	}
	// Older rows might have been saved before modalities was introduced. Their
	// attachment flag is still authoritative and must reach desktop clients.
	if def.Attachment {
		appendInput("image")
	}
	return inputs
}

func clientModelHasInput(inputs []string, expected string) bool {
	for _, input := range inputs {
		if input == expected {
			return true
		}
	}
	return false
}

// GetUserAvailableModelsDetail 返回当前用户分组可用模型的完整元数据(T5.1)。
// GET /api/user/available_models/detail
func GetUserAvailableModelsDetail(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.GetInt(ctxkey.Id)
	userGroup, err := model.CacheGetUserGroup(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	names, err := model.CacheGetGroupModels(ctx, userGroup)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	defs, err := model.GetModelDefinitionsByNames(names)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	// 按 ModelDefinition 排序,与后台模型配置页完全一致(后台用 "sort asc, id asc")。
	sortModelNames(names, defs)

	result := buildClientModelDetails(names, defs)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}

// sortModelNames 原地按后台模型配置页的顺序排列 names,与后台 "sort asc, id asc" 完全一致。
// 未登记主表的模型(defs 中不存在)排在最后。同 sort 时按 ModelDefinition.Id 升序(= 创建顺序),
// 而非按名称——否则 sort 相同的两个模型(如 Auto 与 000)会因名称字母序与后台显示顺序相反。
func sortModelNames(names []string, defs map[string]*model.ModelDefinition) {
	sort.SliceStable(names, func(i, j int) bool {
		di, oki := defs[names[i]]
		dj, okj := defs[names[j]]
		si := 1 << 30
		sj := 1 << 30
		idi := 1 << 30
		idj := 1 << 30
		if oki {
			si = di.Sort
			idi = di.Id
		}
		if okj {
			sj = dj.Sort
			idj = dj.Id
		}
		if si != sj {
			return si < sj
		}
		if idi != idj {
			return idi < idj
		}
		return names[i] < names[j]
	})
}

// buildClientModelDetails 把分组可用模型名 names 与模型定义表 defs 组合成下发给客户端的列表。
// 契约:仅下发在 model_definitions 登记、且启用、且为「对话」类型的模型。渠道(ability)里
// 有但未登记的模型一律不下发——否则会绕过停用/类型过滤直接冒到客户端。抽成纯函数以便单测。
func buildClientModelDetails(names []string, defs map[string]*model.ModelDefinition) []clientModelDetail {
	result := make([]clientModelDetail, 0, len(names))
	for _, name := range names {
		def, ok := defs[name]
		if !ok {
			continue // 未登记 → 不下发
		}
		if !def.Enabled {
			continue // 模型整体停用则不下发
		}
		// 仅「对话」类型在客户端对话框展示;「其他」类型(工具内部用)不下发
		if def.ModelType != "" && def.ModelType != model.ModelTypeChat {
			continue
		}
		d := clientModelDetail{
			Id:          name,
			Name:        name,
			ToolCall:    true,
			Temperature: true,
			Modalities:  clientModelModalities{Input: []string{"text"}, Output: []string{"text"}},
			Limit:       clientModelLimit{Context: config.GetModelContextLimit(name), Output: 0},
		}
		if def.DisplayName != "" {
			d.Name = def.DisplayName
		}
		d.Reasoning = def.Reasoning
		d.ToolCall = def.ToolCall
		if def.ContextLimit > 0 {
			d.Limit.Context = def.ContextLimit
		}
		if def.OutputLimit > 0 {
			d.Limit.Output = def.OutputLimit
		}
		d.Modalities.Input = clientModelInputs(def)
		d.Attachment = def.Attachment || clientModelHasInput(d.Modalities.Input, "image")
		result = append(result, d)
	}
	return result
}
