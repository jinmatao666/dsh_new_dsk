package model

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"sync"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/helper"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var channelModelRegistrationMu sync.Mutex

// ConfiguredModelChannel 不包含密钥，供模型页全量选择渠道，不受渠道列表分页影响。
type ConfiguredModelChannel struct {
	Id     int    `json:"id"`
	Name   string `json:"name"`
	Models string `json:"models"`
	Status int    `json:"status"`
}

func GetConfiguredModelChannels() ([]ConfiguredModelChannel, error) {
	var channels []ConfiguredModelChannel
	err := DB.Model(&Channel{}).Select("id, name, models, status").Order("id asc").Scan(&channels).Error
	return channels, err
}

// ChannelHasConfiguredModel 只检查管理员保存的清单，不访问上游目录或推理接口。
func ChannelHasConfiguredModel(channel *Channel, name string) bool {
	for _, item := range strings.FieldsFunc(channel.Models, func(r rune) bool { return r == ',' || r == '\n' || r == '\r' }) {
		if strings.TrimSpace(item) == name {
			return true
		}
	}
	return false
}

// RegisterChannelModel 原子登记一个模型及其来源、倍率；已有定义仅补来源，不覆盖配置。
func RegisterChannelModel(channelID int, def ModelDefinition, inputRatio, completionRatio float64) (*ModelDefinition, string, error) {
	def.Name = strings.TrimSpace(def.Name)
	if def.Name == "" || len(def.Name) > 255 || def.ContextLimit < 0 {
		return nil, "", errors.New("模型 ID 或上下文不合法")
	}
	if math.IsNaN(inputRatio) || math.IsInf(inputRatio, 0) || inputRatio < 0 || math.IsNaN(completionRatio) || math.IsInf(completionRatio, 0) || completionRatio < 0 {
		return nil, "", errors.New("倍率必须是非负数")
	}
	switch def.ModelType {
	case "chat", "image", "audio", "embedding", "other":
	default:
		return nil, "", errors.New("模型类型不合法")
	}
	channelModelRegistrationMu.Lock()
	defer channelModelRegistrationMu.Unlock()
	status := "created"
	changedOptions := map[string]string{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var channel Channel
		if err := tx.First(&channel, channelID).Error; err != nil {
			return errors.New("来源渠道不存在")
		}
		if !ChannelHasConfiguredModel(&channel, def.Name) {
			return errors.New("模型不在所选渠道的已配置清单中")
		}
		var existing ModelDefinition
		lookup := tx.Where("name = ?", def.Name).First(&existing).Error
		if lookup != nil && !errors.Is(lookup, gorm.ErrRecordNotFound) {
			return lookup
		}
		if lookup == nil {
			def = existing
			status = "bound"
		} else {
			// 能力信息不接受导入声明，新建模型默认禁用，供管理员确认后启用。
			def.Id = 0
			def.Enabled = false
			def.Modalities = ""
			def.Attachment = false
			def.RedirectTo = ""
			def.CreatedTime = helper.GetTimestamp()
			def.UpdatedTime = def.CreatedTime
			if err := tx.Create(&def).Error; err != nil {
				return err
			}
			if err := tx.Model(&def).Update("enabled", false).Error; err != nil {
				return err
			}
			def.Enabled = false
			for _, pair := range []struct {
				key   string
				value float64
			}{{"ModelRatio", inputRatio}, {"CompletionRatio", completionRatio}} {
				key, value := pair.key, pair.value
				option := Option{Key: key}
				config.OptionMapRWMutex.RLock()
				fallback := config.OptionMap[key]
				config.OptionMapRWMutex.RUnlock()
				if fallback == "" {
					fallback = "{}"
				}
				option.Value = fallback
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
					return err
				}
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&option, quoteSQLIdentifier("key")+" = ?", key).Error; err != nil {
					return err
				}
				values := map[string]float64{}
				if err := json.Unmarshal([]byte(option.Value), &values); err != nil {
					return errors.New("已有倍率配置格式异常，请先修复")
				}
				if values == nil {
					values = map[string]float64{}
				}
				values[def.Name] = value
				encoded, err := json.Marshal(values)
				if err != nil {
					return err
				}
				if err = tx.Model(&Option{}).Where(quoteSQLIdentifier("key")+" = ?", key).Update("value", string(encoded)).Error; err != nil {
					return err
				}
				changedOptions[key] = string(encoded)
			}
		}
		ability := Ability{Group: "default", Model: def.Name, ChannelId: channelID, Enabled: channel.Status == ChannelStatusEnabled, Priority: channel.Priority}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ability)
		if result.Error != nil {
			return result.Error
		}
		if status == "bound" && result.RowsAffected == 0 {
			status = "skipped"
		}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	for key, value := range changedOptions {
		_ = updateOptionMap(key, value)
	}
	return &def, status, nil
}
