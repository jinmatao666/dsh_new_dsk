package model

import (
	"errors"
	"fmt"
	"math/rand"

	"github.com/songquanpeng/one-api/common/helper"
	"gorm.io/gorm"
)

// 兑换码状态常量（不使用 0，0 为默认值）。
const (
	InfluencerCodeStatusEnabled  = 1 // 启用
	InfluencerCodeStatusDisabled = 2 // 停用
)

// 生成兑换码时去除易混字符 0/O/1/I，长度固定 8 位。
const influencerCodeChars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const influencerCodeLength = 8
const influencerCodeGenMaxRetry = 5

// InfluencerCode 达人兑换码定义（瘦表）。
//
// 本表只负责"码 → 发码人账户"的映射与达人元信息，不存任何奖励额度/有效期/时间窗口。
// 奖励发放由活动系统的 trigger_type=redeem 活动承载（兑换人 / 发码人各一个活动，
// 通过 grant_role 区分），兑换窗口由活动的 start_time/end_time 控制。
type InfluencerCode struct {
	Id             int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Code           string `json:"code" gorm:"type:varchar(64);uniqueIndex;not null"`                     // 公开兑换码，创建后不可修改
	InfluencerName string `json:"influencer_name" gorm:"type:varchar(100);index"`                        // 达人名称，归因核心
	Channel        string `json:"channel" gorm:"type:varchar(50);not null;uniqueIndex:idx_phone_channel"` // 投放渠道，必填；与发码人手机号组成唯一键
	IssuerUserId   int    `json:"issuer_user_id" gorm:"index;not null"`                                  // 发码人（达人本人）账户 ID
	IssuerPhone    string `json:"issuer_phone" gorm:"type:varchar(20);uniqueIndex:idx_phone_channel"`     // 发码人手机号（11 位裸号），同手机号不同渠道可各有一码
	Status         int    `json:"status" gorm:"type:int;not null;default:1"`         // 1 启用 / 2 停用
	TotalRedeemed  int64  `json:"total_redeemed" gorm:"type:bigint;default:0"`       // 累计兑换人数（冗余计数，统计以归因表为准）
	Remark         string `json:"remark" gorm:"type:varchar(255)"`                   // 备注（达人联系方式、合作信息等）
	CreatedBy      int    `json:"created_by" gorm:"type:int"`                        // 创建管理员 ID
	CreatedTime    int64  `json:"created_time" gorm:"bigint"`                        // 创建时间戳
	UpdatedTime    int64  `json:"updated_time" gorm:"bigint"`                        // 更新时间戳
}

// TableName 指定表名。
func (InfluencerCode) TableName() string {
	return "influencer_codes"
}

// generateInfluencerCode 生成一个唯一的兑换码（去易混字符，唯一索引冲突则重试）。
func generateInfluencerCode() (string, error) {
	for i := 0; i < influencerCodeGenMaxRetry; i++ {
		code := randInfluencerCode()
		var count int64
		if err := DB.Model(&InfluencerCode{}).Where("code = ?", code).Count(&count).Error; err != nil {
			return "", fmt.Errorf("校验兑换码唯一性失败: %w", err)
		}
		if count == 0 {
			return code, nil
		}
	}
	return "", errors.New("生成兑换码失败：多次重试仍冲突")
}

// randInfluencerCode 产生一个 8 位去易混字符的随机码。
func randInfluencerCode() string {
	b := make([]byte, influencerCodeLength)
	for i := 0; i < influencerCodeLength; i++ {
		b[i] = influencerCodeChars[rand.Intn(len(influencerCodeChars))]
	}
	return string(b)
}

// CreateInfluencerCode 创建兑换码。code 为空时自动生成唯一码。
func CreateInfluencerCode(ic *InfluencerCode) error {
	if ic.IssuerUserId == 0 {
		return errors.New("发码人账户不能为空")
	}
	if ic.Code == "" {
		code, err := generateInfluencerCode()
		if err != nil {
			return err
		}
		ic.Code = code
	}
	if ic.Status == 0 {
		ic.Status = InfluencerCodeStatusEnabled
	}
	now := helper.GetTimestamp()
	ic.CreatedTime = now
	ic.UpdatedTime = now
	return DB.Create(ic).Error
}

// GetInfluencerCodeByCode 按码值查询（兑换链路用）。
func GetInfluencerCodeByCode(code string) (*InfluencerCode, error) {
	if code == "" {
		return nil, errors.New("兑换码不能为空")
	}
	var ic InfluencerCode
	err := DB.Where("code = ?", code).First(&ic).Error
	if err != nil {
		return nil, err
	}
	return &ic, nil
}

// GetInfluencerCodeById 按主键查询。
func GetInfluencerCodeById(id int) (*InfluencerCode, error) {
	if id == 0 {
		return nil, errors.New("ID 不能为空")
	}
	var ic InfluencerCode
	err := DB.First(&ic, id).Error
	if err != nil {
		return nil, err
	}
	return &ic, nil
}

// ListInfluencerCodes 分页列表，支持按达人名（模糊）、渠道、状态过滤。
func ListInfluencerCodes(offset, limit int, influencerName, channel, status string) ([]*InfluencerCode, int64, error) {
	query := DB.Model(&InfluencerCode{})
	if influencerName != "" {
		query = query.Where("influencer_name LIKE ?", "%"+influencerName+"%")
	}
	if channel != "" {
		query = query.Where("channel = ?", channel)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var codes []*InfluencerCode
	err := query.Order("id desc").Offset(offset).Limit(limit).Find(&codes).Error
	return codes, total, err
}

// UpdateInfluencerCode 更新运营字段。强制忽略 code / issuer_user_id / issuer_phone 的变更。
func UpdateInfluencerCode(ic *InfluencerCode) error {
	if ic.Id == 0 {
		return errors.New("ID 不能为空")
	}
	return DB.Model(&InfluencerCode{}).Where("id = ?", ic.Id).
		Select("status", "influencer_name", "channel", "remark", "updated_time").
		Updates(map[string]interface{}{
			"status":          ic.Status,
			"influencer_name": ic.InfluencerName,
			"channel":         ic.Channel,
			"remark":          ic.Remark,
			"updated_time":    helper.GetTimestamp(),
		}).Error
}

// IncrInfluencerCodeRedeemed 累计兑换人数 +1（在兑换事务外调用，失败不影响主链路）。
func IncrInfluencerCodeRedeemed(tx *gorm.DB, id int) error {
	db := tx
	if db == nil {
		db = DB
	}
	return db.Model(&InfluencerCode{}).Where("id = ?", id).
		Update("total_redeemed", gorm.Expr("total_redeemed + 1")).Error
}

// DeleteInfluencerCode 删除兑换码（硬删除；建议已有兑换流水的码仅停用，由 controller 判断）。
func DeleteInfluencerCode(id int) error {
	if id == 0 {
		return errors.New("ID 不能为空")
	}
	return DB.Delete(&InfluencerCode{}, id).Error
}

// BatchUpdateInfluencerCodeStatus 批量更新状态（启用/停用）。
func BatchUpdateInfluencerCodeStatus(ids []int, status int) error {
	if len(ids) == 0 {
		return errors.New("未选择兑换码")
	}
	if status != InfluencerCodeStatusEnabled && status != InfluencerCodeStatusDisabled {
		return errors.New("状态值非法")
	}
	return DB.Model(&InfluencerCode{}).Where("id IN ?", ids).
		Updates(map[string]interface{}{
			"status":       status,
			"updated_time": helper.GetTimestamp(),
		}).Error
}

// BatchUpdateInfluencerCodeChannel 批量修改渠道。
func BatchUpdateInfluencerCodeChannel(ids []int, channel string) error {
	if len(ids) == 0 {
		return errors.New("未选择兑换码")
	}
	return DB.Model(&InfluencerCode{}).Where("id IN ?", ids).
		Updates(map[string]interface{}{
			"channel":      channel,
			"updated_time": helper.GetTimestamp(),
		}).Error
}

// BatchDeleteInfluencerCodes 批量删除（硬删除）。
func BatchDeleteInfluencerCodes(ids []int) error {
	if len(ids) == 0 {
		return errors.New("未选择兑换码")
	}
	return DB.Where("id IN ?", ids).Delete(&InfluencerCode{}).Error
}
