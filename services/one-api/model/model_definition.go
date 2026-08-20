package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
	"gorm.io/gorm"
)

// ModelDefinition 模型主表 —— 模型成为一等实体。
//
// 设计要点(见《渠道与模型配置重构开发计划》第四章):
//   - Name 为对外统一模型名(唯一),如 "claude-opus-4-8";各渠道下的真实模型名
//     差异由 ability.Model 承载,必要时配合渠道 model_mapping 重定向。
//   - 计费倍率第一版不进本表,仍走 options(ModelRatio/CompletionRatio map)。
//   - capabilities 字段供桌面端 provider.models 动态下发使用(方案 B),
//     结构对齐 opencode 的 ModelsDev.Model。
// 模型类型:决定是否在客户端对话框展示。
//   - chat(对话):客户端可见可选
//   - other(其他):仅供工具内部调用,不在对话框展示
const (
	ModelTypeChat  = "chat"
	ModelTypeOther = "other"
)

type ModelDefinition struct {
	Id          int    `json:"id"`
	Name        string `json:"name" gorm:"type:varchar(255);uniqueIndex"` // 对外统一模型名,唯一
	DisplayName string `json:"display_name" gorm:"type:varchar(255);default:''"`
	Enabled     bool   `json:"enabled" gorm:"default:true"` // 模型整体启停(所有来源)
	ModelType   string `json:"model_type" gorm:"type:varchar(16);default:'chat'"` // chat=对话(客户端可见) / other=其他
	RedirectTo  string `json:"redirect_to" gorm:"type:varchar(255);default:''"`   // 别名入口:指向的真实模型名;空=普通模型
	Remark      string `json:"remark" gorm:"type:varchar(512);default:''"`
	Sort        int    `json:"sort" gorm:"default:0;index"` // 显示顺序,小在前

	// capabilities —— 供客户端模型同步(方案 B / T5)下发
	ContextLimit int    `json:"context_limit" gorm:"default:0"` // 上下文窗口
	OutputLimit  int    `json:"output_limit" gorm:"default:0"`  // 最大输出
	Modalities   string `json:"modalities" gorm:"type:varchar(255);default:''"` // 逗号分隔: text,image,...
	Reasoning    bool   `json:"reasoning" gorm:"default:false"`
	ToolCall     bool   `json:"tool_call" gorm:"default:true"`
	Attachment   bool   `json:"attachment" gorm:"default:false"`
	// SupportExplicitCache 标记该模型是否支持显式 prompt cache（如阿里云百炼 qwen/glm 系）。
	// 勾选后，网关转发请求时会为其注入 content 块级 cache_control:{type:ephemeral} 锚点，
	// 实现确定性缓存命中。替代此前客户端硬编码白名单，改后台可配、免改代码发版。
	SupportExplicitCache bool `json:"support_explicit_cache" gorm:"default:false"`

	CreatedTime int64 `json:"created_time" gorm:"bigint"`
	UpdatedTime int64 `json:"updated_time" gorm:"bigint"`
}

func GetAllModelDefinitions() ([]*ModelDefinition, error) {
	var defs []*ModelDefinition
	err := DB.Order("sort asc, id asc").Find(&defs).Error
	return defs, err
}

func GetModelDefinitionById(id int) (*ModelDefinition, error) {
	if id == 0 {
		return nil, errors.New("id 为空")
	}
	def := ModelDefinition{Id: id}
	err := DB.First(&def, "id = ?", id).Error
	return &def, err
}

func GetModelDefinitionByName(name string) (*ModelDefinition, error) {
	if name == "" {
		return nil, errors.New("模型名为空")
	}
	def := ModelDefinition{}
	err := DB.First(&def, "name = ?", name).Error
	return &def, err
}

// GetModelDefinitionsByNames 批量取模型定义,返回 name→定义 的 map(供客户端同步聚合用)。
func GetModelDefinitionsByNames(names []string) (map[string]*ModelDefinition, error) {
	result := make(map[string]*ModelDefinition)
	if len(names) == 0 {
		return result, nil
	}
	var defs []*ModelDefinition
	if err := DB.Where("name IN ?", names).Find(&defs).Error; err != nil {
		return result, err
	}
	for _, d := range defs {
		result[d.Name] = d
	}
	return result, nil
}

func (def *ModelDefinition) Insert() error {
	def.Name = strings.TrimSpace(def.Name)
	if def.Name == "" {
		return errors.New("模型名不能为空")
	}
	if def.ModelType == "" {
		def.ModelType = ModelTypeChat
	}
	def.CreatedTime = helper.GetTimestamp()
	def.UpdatedTime = def.CreatedTime
	// gorm 在 Create 结构体时会跳过零值字段(Enabled=false),改用列 default(enabled default:true),
	// 且会把 default 值回填进结构体(Create 后 def.Enabled 变 true)。因此先存下原始意图,
	// Create 后再用 map 显式回写(同 Update 的处理),否则「新建默认禁用」失效。
	wantEnabled := def.Enabled
	if err := DB.Create(def).Error; err != nil {
		if isDuplicateKeyErr(err) {
			return errors.New("模型名「" + def.Name + "」已存在,请换一个")
		}
		return err
	}
	if !wantEnabled {
		if err := DB.Model(def).Where("id = ?", def.Id).Update("enabled", false).Error; err != nil {
			return err
		}
		def.Enabled = false
	}
	return nil
}

// isDuplicateKeyErr 判断是否唯一索引冲突(MySQL 1062 / sqlite UNIQUE)
func isDuplicateKeyErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate entry") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "1062")
}

func (def *ModelDefinition) Update() error {
	def.Name = strings.TrimSpace(def.Name)
	if def.Name == "" {
		return errors.New("模型名不能为空")
	}
	def.UpdatedTime = helper.GetTimestamp()
	if def.ModelType == "" {
		def.ModelType = ModelTypeChat
	}
	// 用 map 显式更新,避免 gorm 结构体更新忽略 bool/数值零值
	// (例如 enabled=false 会被 Updates(struct) 跳过,导致「禁用」无效)。
	return DB.Model(def).Where("id = ?", def.Id).Updates(map[string]interface{}{
		"name":          def.Name,
		"display_name":  def.DisplayName,
		"enabled":       def.Enabled,
		"model_type":    def.ModelType,
		"redirect_to":   def.RedirectTo,
		"remark":        def.Remark,
		"context_limit": def.ContextLimit,
		"output_limit":  def.OutputLimit,
		"modalities":    def.Modalities,
		"reasoning":     def.Reasoning,
		"tool_call":     def.ToolCall,
		"attachment":    def.Attachment,
		"support_explicit_cache": def.SupportExplicitCache,
		"updated_time":  def.UpdatedTime,
		// 注意:不更新 sort —— 显示顺序只由 ReorderModelDefinitions 维护,
		// 否则启用/禁用等普通更新会把 sort 重置为零值导致模型跳位。
	}).Error
}

// ReorderModelDefinitions 按传入的 id 顺序批量写入 sort(显示顺序持久化)。
// 仅更新已登记主表的模型;未登记的历史模型不在排序范围内。
func ReorderModelDefinitions(orderedIds []int) error {
	if len(orderedIds) == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		for idx, id := range orderedIds {
			if err := tx.Model(&ModelDefinition{}).Where("id = ?", id).
				Update("sort", idx).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (def *ModelDefinition) Delete() error {
	if def.Id == 0 {
		return errors.New("id 为空")
	}
	return DB.Delete(def).Error
}

// UpdateModelDefinitionEnabled 仅更新启停状态(bool 字段用 Updates 会被零值忽略,故单独处理)
func UpdateModelDefinitionEnabled(id int, enabled bool) error {
	return DB.Model(&ModelDefinition{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"enabled":      enabled,
			"updated_time": helper.GetTimestamp(),
		}).Error
}

// BackfillModelDefinitions 数据迁移(T4.1):把现有 ability 表里去重的模型名补登到
// ModelDefinition 主表(已存在则跳过)。幂等,可在每次启动调用。
//
// ability 表本身在历史版本由 channel.Models 派生而来,因此遍历 ability 的 distinct model
// 等价于「遍历所有渠道声明过的模型」。倍率/上下文不在此处迁移(仍走 options)。
func BackfillModelDefinitions() error {
	var modelNames []string
	if err := DB.Model(&Ability{}).Distinct("model").Pluck("model", &modelNames).Error; err != nil {
		return err
	}
	if len(modelNames) == 0 {
		return nil
	}
	// 已存在的模型名集合
	existing, err := GetModelDefinitionsByNames(modelNames)
	if err != nil {
		return err
	}
	now := helper.GetTimestamp()
	created := 0
	for _, name := range modelNames {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, ok := existing[name]; ok {
			continue
		}
		def := ModelDefinition{
			Name: name, DisplayName: name, Enabled: true, ToolCall: true,
			ModelType: ModelTypeChat, CreatedTime: now, UpdatedTime: now,
		}
		if err := DB.Create(&def).Error; err != nil {
			return err
		}
		created++
	}
	if created > 0 {
		logger.SysLog("backfilled model definitions: " + strconv.Itoa(created))
	}
	return nil
}
