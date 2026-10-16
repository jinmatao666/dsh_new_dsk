package model

import "time"

// UsageEvent is one accepted skill invocation or expert task start. EventID is
// stable across delivery retries; it is not a conversation-level deduplication key.
type UsageEvent struct {
	EventID        string    `json:"event_id" gorm:"primaryKey;size:128"`
	Kind           string    `json:"kind" gorm:"size:16;index:idx_usage_kind_day,priority:1;index:idx_usage_kind_item,priority:1"`
	InvocationType string    `json:"invocation_type" gorm:"size:20"`
	ItemID         string    `json:"item_id" gorm:"size:160;index:idx_usage_kind_item,priority:2"`
	ItemName       string    `json:"item_name" gorm:"size:160"`
	UserID         int       `json:"user_id" gorm:"index"`
	Username       string    `json:"username" gorm:"size:100"`
	DepartmentID   *int      `json:"department_id" gorm:"index"`
	DepartmentName string    `json:"department_name" gorm:"size:100"`
	Day            string    `json:"day" gorm:"size:10;index:idx_usage_kind_day,priority:2"`
	OccurredAt     time.Time `json:"occurred_at" gorm:"index"`
}
