package model

import "fmt"

type Feedback struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Username     string `json:"username" gorm:"size:100;default:''"`
	FeedbackType string `json:"feedback_type" gorm:"size:50;default:''"`
	Content      string `json:"content" gorm:"type:text;not null"`
	AppVersion   string `json:"app_version" gorm:"size:50;default:''"`
	Context      string `json:"context" gorm:"type:text"`
	// Images 存 JSON 编码的 base64 data-URL 数组；用 longtext 避免多张截图撑爆 text(64KB)
	Images    string `json:"images" gorm:"type:text"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
}

func CreateFeedback(feedback *Feedback) error {
	return DB.Create(feedback).Error
}

// GetFeedbackList 获取反馈明细列表（AdminAuth）
func GetFeedbackList(feedbackType, username string, offset, limit int) ([]Feedback, int64, error) {
	var list []Feedback
	var total int64

	query := DB.Model(&Feedback{})
	if feedbackType != "" {
		query = query.Where("feedback_type = ?", feedbackType)
	}
	if username != "" {
		query = query.Where("username LIKE ?", fmt.Sprintf("%%%s%%", username))
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&list).Error
	return list, total, err
}
