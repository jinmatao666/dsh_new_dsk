package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	billingratio "github.com/songquanpeng/one-api/relay/billing/ratio"
)

// 模型主表 CRUD(T1.2)+ 模型↔渠道关系管理(T1.3)

func GetAllModelDefinitions(c *gin.Context) {
	defs, err := model.GetAllModelDefinitions()
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    defs,
	})
}

func GetModelDefinition(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondError(c, err.Error())
		return
	}
	def, err := model.GetModelDefinitionById(id)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    def,
	})
}

func AddModelDefinition(c *gin.Context) {
	def := model.ModelDefinition{}
	if err := c.ShouldBindJSON(&def); err != nil {
		respondError(c, err.Error())
		return
	}
	if err := def.Insert(); err != nil {
		respondError(c, err.Error())
		return
	}
	// 别名入口:自动把别名挂到目标模型的渠道 + 写 model_mapping,使其路由到真实模型
	if def.RedirectTo != "" {
		if err := model.SetupAliasEntry(def.Name, def.RedirectTo); err != nil {
			// 别名路由失败:回滚刚建的模型定义,避免留下无法路由的孤儿入口
			_ = def.Delete()
			respondError(c, "配置别名路由失败:"+err.Error())
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    def,
	})
}

func UpdateModelDefinition(c *gin.Context) {
	def := model.ModelDefinition{}
	if err := c.ShouldBindJSON(&def); err != nil {
		respondError(c, err.Error())
		return
	}
	if def.Id == 0 {
		respondError(c, "缺少模型 id")
		return
	}
	if err := def.Update(); err != nil {
		respondError(c, err.Error())
		return
	}
	// 立即刷新显式缓存模型集合，使"显式缓存"勾选变更即时生效（不等定时同步）。
	model.InitExplicitCacheModelCache()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    def,
	})
}

func DeleteModelDefinition(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondError(c, err.Error())
		return
	}
	// 先读出来:若是别名入口,删除后需清理其 ability + 渠道 model_mapping
	existing, _ := model.GetModelDefinitionById(id)
	// 启用中的模型不允许删除,须先禁用(防止绕过前端直接调用接口)
	if existing != nil && existing.Enabled {
		respondError(c, "请先禁用该模型后再删除")
		return
	}
	def := model.ModelDefinition{Id: id}
	if err := def.Delete(); err != nil {
		respondError(c, err.Error())
		return
	}
	if existing != nil && existing.RedirectTo != "" {
		if err := model.RemoveAliasEntry(existing.Name); err != nil {
			logger.SysError("清理别名入口路由失败: " + err.Error())
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

// ReorderModelDefinitions 持久化模型显示顺序(拖拽排序)。
// PUT /api/model_definition/reorder  body: { ids: [3,1,2,...] }
func ReorderModelDefinitions(c *gin.Context) {
	var req struct {
		Ids []int `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, err.Error())
		return
	}
	if err := model.ReorderModelDefinitions(req.Ids); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func respondError(c *gin.Context, message string) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": message,
	})
}

// AggregatedModel 模型配置页一行所需的聚合数据(T1.6):
// ModelDefinition 主表元数据 + ability 渠道来源 + options 倍率/上下文。
type AggregatedModel struct {
	Id                   int                        `json:"id"` // ModelDefinition.Id;仅来自 ability 的历史模型为 0
	Name                 string                     `json:"name"`
	DisplayName          string                     `json:"display_name"`
	Enabled              bool                       `json:"enabled"`
	ModelType            string                     `json:"model_type"`
	RedirectTo           string                     `json:"redirect_to"`
	Remark               string                     `json:"remark"`
	InModelDef           bool                       `json:"in_model_def"` // 是否已登记到主表
	Sources              []model.ModelChannelSource `json:"sources"`
	ModelRatio           float64                    `json:"model_ratio"`
	CompletionRatio      float64                    `json:"completion_ratio"`
	ContextLimit         int                        `json:"context_limit"`
	Modalities           string                     `json:"modalities"`
	Attachment           bool                       `json:"attachment"`
	SupportExplicitCache bool                       `json:"support_explicit_cache"` // 是否勾选显式缓存
}

// ListAggregatedModels 模型配置页聚合列表(T1.6)。
// 合并:ModelDefinition 主表(手动登记) + 其渠道来源(ability) + options 倍率/上下文。
// 不再合并 ability 派生模型——模型配置全手动登记。
// GET /api/model_definition/aggregated
func ListAggregatedModels(c *gin.Context) {
	defs, err := model.GetAllModelDefinitions()
	if err != nil {
		respondError(c, err.Error())
		return
	}
	allSources, err := model.GetAllModelChannelSources()
	if err != nil {
		respondError(c, err.Error())
		return
	}

	// 来源按模型名分组
	sourcesByModel := make(map[string][]model.ModelChannelSource)
	for _, s := range allSources {
		sourcesByModel[s.Model] = append(sourcesByModel[s.Model], s)
	}

	ratios := billingratio.GetAllModelRatios()
	completionRatios := billingratio.GetAllCompletionRatios()

	// 仅遍历主表(手动登记的模型)
	order := make([]string, 0)
	byName := make(map[string]*AggregatedModel)
	for _, d := range defs {
		m := &AggregatedModel{
			Id: d.Id, Name: d.Name, DisplayName: d.DisplayName,
			Enabled: d.Enabled, ModelType: d.ModelType, RedirectTo: d.RedirectTo, Remark: d.Remark, InModelDef: true,
			ContextLimit:         d.ContextLimit,
			Modalities:           d.Modalities,
			Attachment:           d.Attachment,
			SupportExplicitCache: d.SupportExplicitCache,
		}
		byName[d.Name] = m
		order = append(order, d.Name)
	}

	result := make([]*AggregatedModel, 0, len(order))
	for _, name := range order {
		m := byName[name]
		m.Sources = sourcesByModel[name]
		if m.Sources == nil {
			m.Sources = []model.ModelChannelSource{}
		}
		m.ModelRatio = ratios[name]
		m.CompletionRatio = completionRatios[name]
		// 别名入口自身在倍率 map 里没有键(计费按重定向后的目标名走),
		// 列表展示回退取目标真实模型的倍率,让管理员直观看到该入口实际计费倍率。
		if m.RedirectTo != "" {
			if r, ok := ratios[m.RedirectTo]; ok {
				m.ModelRatio = r
			}
			if cr, ok := completionRatios[m.RedirectTo]; ok {
				m.CompletionRatio = cr
			}
		}
		// 优先用主表登记值(列表功能直接写 model_definitions.context_limit,已在上方 ContextLimit 字段填入);
		// 为 0 时回退到 options 关键词映射(历史配置兼容)。
		if m.ContextLimit == 0 {
			m.ContextLimit = config.GetModelContextLimit(name)
		}
		result = append(result, m)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    result,
	})
}
