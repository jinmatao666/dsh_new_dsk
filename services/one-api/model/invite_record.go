package model

import (
	"time"
)

// InviteRecord 邀请关系记录
type InviteRecord struct {
	Id        int       `json:"id" gorm:"primaryKey;autoIncrement"`
	InviterId int       `json:"inviter_id" gorm:"index;not null"`
	InviteeId int       `json:"invitee_id" gorm:"index;not null"`
	AffCode   string    `json:"aff_code" gorm:"type:varchar(32);not null"`
	EventType string    `json:"event_type" gorm:"type:varchar(20);not null"` // registration / payment
	OrderNo   string    `json:"order_no" gorm:"type:varchar(64)"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}

func (InviteRecord) TableName() string { return "invite_records" }

// InviteStats 邀请统计
type InviteStats struct {
	TotalInvitees int `json:"total_invitees"`
	TotalPayments int `json:"total_payments"`
}

// InviteListItem 邀请列表条目（脱敏）
type InviteListItem struct {
	InviteeDisplayName string    `json:"invitee_display_name"`
	EventType          string    `json:"event_type"`
	CreatedAt          time.Time `json:"created_at"`
}

// CreateInviteRecord 写入一条邀请记录
func CreateInviteRecord(inviterId, inviteeId int, affCode, eventType, orderNo string) error {
	record := InviteRecord{
		InviterId: inviterId,
		InviteeId: inviteeId,
		AffCode:   affCode,
		EventType: eventType,
		OrderNo:   orderNo,
	}
	return DB.Create(&record).Error
}

// HasInviteRecord 检查是否已存在同一被邀请人+事件类型的邀请记录（防重复发放）
func HasInviteRecord(inviteeId int, eventType string) (bool, error) {
	var count int64
	err := DB.Model(&InviteRecord{}).
		Where("invitee_id = ? AND event_type = ?", inviteeId, eventType).
		Count(&count).Error
	return count > 0, err
}

// GetInviteStats 获取邀请人统计
func GetInviteStats(inviterId int) (*InviteStats, error) {
	stats := &InviteStats{}

	var registrationCount int64
	if err := DB.Model(&InviteRecord{}).
		Where("inviter_id = ? AND event_type = ?", inviterId, "registration").
		Count(&registrationCount).Error; err != nil {
		return nil, err
	}
	stats.TotalInvitees = int(registrationCount)

	var paymentCount int64
	if err := DB.Model(&InviteRecord{}).
		Where("inviter_id = ? AND event_type = ?", inviterId, "payment").
		Count(&paymentCount).Error; err != nil {
		return nil, err
	}
	stats.TotalPayments = int(paymentCount)

	return stats, nil
}

// GetInviteList 分页获取邀请人的被邀请用户列表
func GetInviteList(inviterId, page, pageSize int) ([]*InviteListItem, int64, error) {
	if page < 0 {
		page = 0
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	var total int64
	if err := DB.Model(&InviteRecord{}).
		Where("inviter_id = ?", inviterId).
		Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type rawRow struct {
		InviteeId   int
		EventType   string
		CreatedAt   time.Time
		DisplayName string
	}

	var rows []rawRow
	err := DB.Table("invite_records ir").
		Select("ir.invitee_id, ir.event_type, ir.created_at, COALESCE(u.display_name, '') as display_name").
		Joins("LEFT JOIN users u ON u.id = ir.invitee_id").
		Where("ir.inviter_id = ?", inviterId).
		Order("ir.created_at DESC").
		Offset(page * pageSize).
		Limit(pageSize).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}

	items := make([]*InviteListItem, 0, len(rows))
	for _, r := range rows {
		name := r.DisplayName
		runes := []rune(name)
		if len(runes) > 1 {
			masked := string(runes[0])
			for i := 1; i < len(runes); i++ {
				masked += "*"
			}
			name = masked
		}
		items = append(items, &InviteListItem{
			InviteeDisplayName: name,
			EventType:          r.EventType,
			CreatedAt:          r.CreatedAt,
		})
	}

	return items, total, nil
}
