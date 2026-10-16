package model

// SkillTestSession retains the reviewed snapshot and transcript, never model credentials.
// Its lifecycle is separate from published skills and formal usage events.
// Unbounded strings use dialect-native text: PostgreSQL/SQLite text and MySQL longtext.
type SkillTestSession struct {
	Id                string `json:"id" gorm:"primaryKey;size:32"`
	SkillId           int    `json:"skill_id" gorm:"index;not null"`
	SkillName         string `json:"skill_name" gorm:"size:100"`
	Version           string `json:"version" gorm:"size:50"`
	SnapshotHash      string `json:"snapshot_hash" gorm:"size:64"`
	SourceUpdatedAt   int64  `json:"source_updated_at"`
	SourceSubmittedAt int64  `json:"source_submitted_at"`
	Snapshot          string `json:"-"`
	ReviewerId        int    `json:"reviewer_id" gorm:"index"`
	Reviewer          string `json:"reviewer" gorm:"size:100"`
	Model             string `json:"model" gorm:"size:255"`
	Status            string `json:"status" gorm:"size:20;index"`
	Error             string `json:"error" gorm:"type:text"`
	Transcript        string `json:"-"`
	Events            string `json:"-"`
	CreatedAt         int64  `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt         int64  `json:"updated_at" gorm:"autoUpdateTime"`
	ExpiresAt         int64  `json:"expires_at"`
}
