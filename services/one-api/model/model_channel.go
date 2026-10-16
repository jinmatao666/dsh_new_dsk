package model

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"gorm.io/gorm"
)

// 模型↔渠道关系维护(T1.3)
//
// ability 表 (group, model, channel_id, enabled, priority) 是「模型挂渠道」的唯一权威。
// 模型页通过以下函数独占维护模型的渠道来源:增删 ability 行、设来源优先级。
// 第一版分组维度默认 "default"。

const defaultAbilityGroup = "default"

// ModelChannelSource 模型的一个渠道来源(ability 行 + 渠道展示信息)
type ModelChannelSource struct {
	Group       string `json:"group"`
	Model       string `json:"model"`
	ChannelId   int    `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	ChannelType int    `json:"channel_type"`
	Status      int    `json:"status"` // 渠道整体状态
	Enabled     bool   `json:"enabled"`
	Priority    int64  `json:"priority"`
}

// GetModelChannelSources 查某模型的全部渠道来源(联表渠道名/类型/状态)
func GetModelChannelSources(modelName string) ([]ModelChannelSource, error) {
	if modelName == "" {
		return nil, errors.New("模型名为空")
	}
	var sources []ModelChannelSource
	groupCol := qualifiedSQLColumn("abilities", "group")
	err := DB.Table("abilities").
		Select(groupCol+", abilities.model, abilities.channel_id, abilities.enabled, abilities.priority, "+
			"channels.name as channel_name, channels.type as channel_type, channels.status").
		Joins("LEFT JOIN channels ON channels.id = abilities.channel_id").
		Where("abilities.model = ?", modelName).
		Scan(&sources).Error
	return sources, err
}

// AddModelChannelSource 给模型新增一个渠道来源(写一条 ability)。
// enabled 跟随渠道当前状态;priority 默认取渠道 priority,可由 priority 参数覆盖。
func AddModelChannelSource(modelName string, channelId int, group string, priority *int64) error {
	if modelName == "" {
		return errors.New("模型名为空")
	}
	if group == "" {
		group = defaultAbilityGroup
	}
	channel, err := GetChannelById(channelId, false)
	if err != nil {
		return errors.New("渠道不存在")
	}
	p := channel.Priority
	if priority != nil {
		p = priority
	}
	ability := Ability{
		Group:     group,
		Model:     modelName,
		ChannelId: channelId,
		Enabled:   channel.Status == ChannelStatusEnabled,
		Priority:  p,
	}
	// 幂等:已存在则更新 enabled/priority,不存在则插入
	return DB.Where(quoteSQLIdentifier("group")+" = ? AND model = ? AND channel_id = ?", group, modelName, channelId).
		Assign(map[string]interface{}{"enabled": ability.Enabled, "priority": ability.Priority}).
		FirstOrCreate(&ability).Error
}

// DeleteModelChannelSource 删除模型的一个渠道来源
func DeleteModelChannelSource(modelName string, channelId int, group string) error {
	if modelName == "" {
		return errors.New("模型名为空")
	}
	if group == "" {
		group = defaultAbilityGroup
	}
	return DB.Where(quoteSQLIdentifier("group")+" = ? AND model = ? AND channel_id = ?", group, modelName, channelId).
		Delete(&Ability{}).Error
}

// SetModelChannelSourcePriority 设置模型某来源的优先级
func SetModelChannelSourcePriority(modelName string, channelId int, group string, priority int64) error {
	if modelName == "" {
		return errors.New("模型名为空")
	}
	if group == "" {
		group = defaultAbilityGroup
	}
	return DB.Model(&Ability{}).
		Where(quoteSQLIdentifier("group")+" = ? AND model = ? AND channel_id = ?", group, modelName, channelId).
		Update("priority", priority).Error
}

// GetAllAbilityModels 返回 ability 表里所有去重的模型名(用于聚合那些尚未登记到
// ModelDefinition 主表、但已有渠道来源的历史模型)。
func GetAllAbilityModels() ([]string, error) {
	var models []string
	err := DB.Model(&Ability{}).Distinct("model").Pluck("model", &models).Error
	return models, err
}

// GetAllModelChannelSources 一次性取出所有来源(联表渠道信息),供聚合接口按模型分组,
// 避免逐模型 N 次查询。
func GetAllModelChannelSources() ([]ModelChannelSource, error) {
	var sources []ModelChannelSource
	groupCol := qualifiedSQLColumn("abilities", "group")
	err := DB.Table("abilities").
		Select(groupCol + ", abilities.model, abilities.channel_id, abilities.enabled, abilities.priority, " +
			"channels.name as channel_name, channels.type as channel_type, channels.status").
		Joins("LEFT JOIN channels ON channels.id = abilities.channel_id").
		Scan(&sources).Error
	return sources, err
}

// CandidateChannel 候选渠道(供新增模型时按模型名探测可用渠道)
type CandidateChannel struct {
	Id     int    `json:"id"`
	Name   string `json:"name"`
	Type   int    `json:"type"`
	Status int    `json:"status"`
}

// GetChannelsSupportingModel 查 channel.Models 字段里包含该模型名的渠道(候选来源)。
// 用逗号包裹精确匹配,避免子串误命中(如 gpt-4 命中 gpt-4o)。
func GetChannelsSupportingModel(modelName string) ([]CandidateChannel, error) {
	if modelName == "" {
		return nil, errors.New("模型名为空")
	}
	var chs []CandidateChannel
	// CONCAT(',', models, ',') LIKE '%,name,%' 实现按逗号分隔的精确成员匹配
	err := DB.Table("channels").
		Select("id, name, type, status").
		Where("CONCAT(',', models, ',') LIKE ?", "%,"+modelName+",%").
		Scan(&chs).Error
	return chs, err
}

// SetupAliasEntry 为「别名入口」配置路由:把别名挂到目标真实模型所在的每个渠道,
// 并在这些渠道的 model_mapping 里写入「别名→真实名」,使请求别名时被改写为真实模型发往上游。
//
// 复用现有 relay 改写链路(distributor 取渠道 model_mapping → relay 改写),
// 计费/上下文按改写后的真实名计算,无需改 relay。幂等:重复调用安全。
func SetupAliasEntry(alias, target string) error {
	if alias == "" || target == "" {
		return errors.New("别名或目标模型为空")
	}
	if alias == target {
		return errors.New("别名不能与目标模型同名")
	}
	// 目标真实模型当前的所有 ability 来源(它由哪些渠道提供)
	var targetAbilities []Ability
	if err := DB.Where("model = ?", target).Find(&targetAbilities).Error; err != nil {
		return err
	}
	if len(targetAbilities) == 0 {
		return errors.New("目标模型「" + target + "」尚无渠道来源,请先给它配置渠道")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		channelIds := make(map[int]bool)
		for _, ta := range targetAbilities {
			// 1. 给别名在同一渠道、同分组写一条 ability(幂等)
			ab := Ability{
				Group:     ta.Group,
				Model:     alias,
				ChannelId: ta.ChannelId,
				Enabled:   ta.Enabled,
				Priority:  ta.Priority,
			}
			if err := tx.Where(quoteSQLIdentifier("group")+" = ? AND model = ? AND channel_id = ?", ta.Group, alias, ta.ChannelId).
				Assign(map[string]interface{}{"enabled": ta.Enabled, "priority": ta.Priority}).
				FirstOrCreate(&ab).Error; err != nil {
				return err
			}
			channelIds[ta.ChannelId] = true
		}
		// 2. 在涉及的每个渠道 model_mapping 写入 alias→target
		for chId := range channelIds {
			if err := upsertChannelModelMappingTx(tx, chId, alias, target); err != nil {
				return err
			}
		}
		return nil
	})
}

// RemoveAliasEntry 撤销别名入口的路由:删 ability + 从渠道 model_mapping 移除该别名键。
func RemoveAliasEntry(alias string) error {
	if alias == "" {
		return errors.New("别名为空")
	}
	var abilities []Ability
	if err := DB.Where("model = ?", alias).Find(&abilities).Error; err != nil {
		return err
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		chIds := make(map[int]bool)
		for _, a := range abilities {
			chIds[a.ChannelId] = true
		}
		if err := tx.Where("model = ?", alias).Delete(&Ability{}).Error; err != nil {
			return err
		}
		for chId := range chIds {
			if err := deleteChannelModelMappingKeyTx(tx, chId, alias); err != nil {
				return err
			}
		}
		return nil
	})
}

// upsertChannelModelMappingTx 在指定渠道的 model_mapping JSON 里写入/更新一个键值(事务内)。
func upsertChannelModelMappingTx(tx *gorm.DB, channelId int, key, value string) error {
	var ch Channel
	if err := tx.First(&ch, "id = ?", channelId).Error; err != nil {
		return err
	}
	m := map[string]string{}
	if ch.ModelMapping != nil && *ch.ModelMapping != "" && *ch.ModelMapping != "{}" {
		_ = json.Unmarshal([]byte(*ch.ModelMapping), &m)
	}
	if m[key] == value {
		return nil // 幂等
	}
	m[key] = value
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	s := string(b)
	return tx.Model(&Channel{}).Where("id = ?", channelId).Update("model_mapping", s).Error
}

// deleteChannelModelMappingKeyTx 从指定渠道 model_mapping 移除某个键(事务内)。
func deleteChannelModelMappingKeyTx(tx *gorm.DB, channelId int, key string) error {
	var ch Channel
	if err := tx.First(&ch, "id = ?", channelId).Error; err != nil {
		return err
	}
	if ch.ModelMapping == nil || *ch.ModelMapping == "" {
		return nil
	}
	m := map[string]string{}
	if err := json.Unmarshal([]byte(*ch.ModelMapping), &m); err != nil {
		return nil // 解析失败不阻断
	}
	if _, ok := m[key]; !ok {
		return nil
	}
	delete(m, key)
	b, _ := json.Marshal(m)
	s := string(b)
	return tx.Model(&Channel{}).Where("id = ?", channelId).Update("model_mapping", s).Error
}

// GetAllChannelModelNames 汇总所有渠道 models 字段里出现过的去重模型名(供新增模型时搜索选择)。
func GetAllChannelModelNames() ([]string, error) {
	var modelsCols []string
	if err := DB.Model(&Channel{}).Pluck("models", &modelsCols).Error; err != nil {
		return nil, err
	}
	set := make(map[string]bool)
	for _, mc := range modelsCols {
		for _, name := range strings.Split(mc, ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				set[name] = true
			}
		}
	}
	out := make([]string, 0, len(set))
	for name := range set {
		out = append(out, name)
	}
	sort.Strings(out)
	return out, nil
}
