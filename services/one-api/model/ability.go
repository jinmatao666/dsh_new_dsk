package model

import (
	"context"
	"sort"
	"strings"

	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/utils"
)

type Ability struct {
	Group     string `json:"group" gorm:"type:varchar(32);primaryKey;autoIncrement:false"`
	Model     string `json:"model" gorm:"primaryKey;autoIncrement:false"`
	ChannelId int    `json:"channel_id" gorm:"primaryKey;autoIncrement:false;index"`
	Enabled   bool   `json:"enabled"`
	Priority  *int64 `json:"priority" gorm:"bigint;default:0;index"`
}

func GetRandomSatisfiedChannel(group string, model string, ignoreFirstPriority bool) (*Channel, error) {
	ability := Ability{}
	groupCol := quoteSQLIdentifier("group")
	trueVal := sqlBooleanLiteral(true)

	var err error = nil
	var channelQuery *gorm.DB
	if ignoreFirstPriority {
		channelQuery = DB.Where(groupCol+" = ? and model = ? and enabled = "+trueVal, group, model)
	} else {
		maxPrioritySubQuery := DB.Model(&Ability{}).Select("MAX(priority)").Where(groupCol+" = ? and model = ? and enabled = "+trueVal, group, model)
		channelQuery = DB.Where(groupCol+" = ? and model = ? and enabled = "+trueVal+" and priority = (?)", group, model, maxPrioritySubQuery)
	}
	if common.UsingSQLite || common.UsingPostgreSQL {
		err = channelQuery.Order("RANDOM()").First(&ability).Error
	} else {
		err = channelQuery.Order("RAND()").First(&ability).Error
	}
	if err != nil {
		return nil, err
	}
	channel := Channel{}
	channel.Id = ability.ChannelId
	err = DB.First(&channel, "id = ?", ability.ChannelId).Error
	return &channel, err
}

func (channel *Channel) AddAbilities() error {
	models_ := strings.Split(channel.Models, ",")
	models_ = utils.DeDuplication(models_)
	groups_ := strings.Split(channel.Group, ",")
	abilities := make([]Ability, 0, len(models_))
	for _, model := range models_ {
		for _, group := range groups_ {
			ability := Ability{
				Group:     group,
				Model:     model,
				ChannelId: channel.Id,
				Enabled:   channel.Status == ChannelStatusEnabled,
				Priority:  channel.Priority,
			}
			abilities = append(abilities, ability)
		}
	}
	return DB.Create(&abilities).Error
}

func (channel *Channel) DeleteAbilities() error {
	return DB.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
}

// UpdateAbilities updates abilities of this channel.
// Make sure the channel is completed before calling this function.
//
// DEPRECATED(T1.4 ability 权威化):此「全删重建」逻辑会冲掉模型页配置的渠道来源,
// 渠道保存路径已改用 SyncAbilitiesOnUpdate,不再调用本函数。仅保留供数据迁移
// 脚本(T4.1)按 channel.Models 初始化 ability 时使用,常规业务勿调用。
func (channel *Channel) UpdateAbilities() error {
	// A quick and dirty way to update abilities
	// First delete all abilities of this channel
	err := channel.DeleteAbilities()
	if err != nil {
		return err
	}
	// Then add new abilities
	err = channel.AddAbilities()
	if err != nil {
		return err
	}
	return nil
}

func UpdateAbilityStatus(channelId int, status bool) error {
	return DB.Model(&Ability{}).Where("channel_id = ?", channelId).Select("enabled").Update("enabled", status).Error
}

// SyncAbilitiesOnUpdate 在渠道保存时,只同步「跟随渠道变化的属性」到该渠道已有的
// ability 行,而不增删模型↔渠道映射(T1.4 ability 权威化)。
//
// 同步项:
//   - priority:跟随 channel.Priority
//   - enabled:跟随 channel.Status 是否为启用
//
// 模型↔渠道关系的增删由模型页通过 ability 增删独占维护,渠道页不再触碰,
// 避免「渠道页保存冲掉模型页配置」。group 维度变化暂不在此处理(第一版默认 default 分组)。
func (channel *Channel) SyncAbilitiesOnUpdate() error {
	return DB.Model(&Ability{}).
		Where("channel_id = ?", channel.Id).
		Updates(map[string]interface{}{
			"priority": channel.Priority,
			"enabled":  channel.Status == ChannelStatusEnabled,
		}).Error
}

func GetGroupModels(ctx context.Context, group string) ([]string, error) {
	groupCol := quoteSQLIdentifier("group")
	trueVal := sqlBooleanLiteral(true)
	var models []string
	err := DB.Model(&Ability{}).Distinct("model").Where(groupCol+" = ? and enabled = "+trueVal, group).Pluck("model", &models).Error
	if err != nil {
		return nil, err
	}
	sort.Strings(models)
	return models, err
}
