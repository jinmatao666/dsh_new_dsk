package model

import (
	"context"
	"strings"

	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
)

// UserPromptAudit 是面向管理员的长期审计记录。它刻意只保存用户本次发出的
// 文本问题与请求结果，不保存模型回答、图片附件或完整历史上下文。
//
// 与 logs 表不同，此表不参与常规调用日志清理，因此可用于长期问题追溯。
type UserPromptAudit struct {
	Id               int    `json:"id"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;index:idx_prompt_audit_created"`
	UpdatedAt        int64  `json:"updated_at" gorm:"bigint"`
	UserId           int    `json:"user_id" gorm:"index:idx_prompt_audit_user_created,priority:1"`
	Username         string `json:"username" gorm:"index;default:''"`
	ChannelId        int    `json:"channel_id" gorm:"index"`
	ModelName        string `json:"model_name" gorm:"index;default:''"`
	// SessionId is the opaque DSH desktop conversation id. It is only used to
	// group the administrator's prompt audit; the conversation itself remains
	// on the user's local desktop and is never uploaded here.
	SessionId        string `json:"session_id" gorm:"type:varchar(256);index;default:''"`
	RequestId        string `json:"request_id" gorm:"uniqueIndex;default:''"`
	Question         string `json:"question" gorm:"type:text"`
	Status           string `json:"status" gorm:"index;default:'processing'"`
	ErrorMessage     string `json:"error_message" gorm:"type:text;default:''"`
	Quota            int    `json:"quota" gorm:"default:0"`
	PromptTokens     int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens int    `json:"completion_tokens" gorm:"default:0"`
	ElapsedTime      int64  `json:"elapsed_time" gorm:"default:0"`
}

func (UserPromptAudit) TableName() string {
	return "user_prompt_audits"
}

func trimAuditText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

// StartUserPromptAudit 在请求真正发送给上游前记录本次用户问题，保证上游异常时
// 仍然保留可追溯的问题文本。
func StartUserPromptAudit(ctx context.Context, userId, channelId int, modelName, sessionId, question string) {
	question = trimAuditText(question, 20000)
	sessionId = trimAuditText(sessionId, 256)
	if question == "" || userId == 0 {
		return
	}
	now := helper.GetTimestamp()
	audit := &UserPromptAudit{
		CreatedAt: now,
		UpdatedAt: now,
		UserId:    userId,
		Username:  GetUsernameById(userId),
		ChannelId: channelId,
		ModelName: modelName,
		SessionId: sessionId,
		RequestId: helper.GetRequestID(ctx),
		Question:  question,
		Status:    "processing",
	}
	if err := DB.Create(audit).Error; err != nil {
		logger.Errorf(ctx, "failed to start user prompt audit: %s", err.Error())
	}
}

// FinishUserPromptAudit 仅更新此前已经创建的审计记录；不影响正常模型调用。
func FinishUserPromptAudit(ctx context.Context, status, errorMessage string, quota, promptTokens, completionTokens int, elapsedTime int64) {
	requestId := helper.GetRequestID(ctx)
	if requestId == "" {
		return
	}
	updates := map[string]any{
		"updated_at":        helper.GetTimestamp(),
		"status":            status,
		"error_message":     trimAuditText(errorMessage, 2000),
		"quota":             quota,
		"prompt_tokens":     promptTokens,
		"completion_tokens": completionTokens,
		"elapsed_time":      elapsedTime,
	}
	if err := DB.Model(&UserPromptAudit{}).Where("request_id = ?", requestId).Updates(updates).Error; err != nil {
		logger.Errorf(ctx, "failed to finish user prompt audit: %s", err.Error())
	}
}

func GetUserPromptAudits(keyword string, startIdx, num int) (audits []*UserPromptAudit, err error) {
	query := DB.Model(&UserPromptAudit{})
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("username LIKE ? OR model_name LIKE ? OR question LIKE ? OR error_message LIKE ?", like, like, like, like)
	}
	err = query.Order("created_at DESC").Limit(num).Offset(startIdx).Find(&audits).Error
	return audits, err
}
