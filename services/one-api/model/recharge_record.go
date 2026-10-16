package model

import (
	"time"
)

type RechargeRecord struct {
	Id          int       `json:"id" gorm:"primaryKey"`
	UserId      int       `json:"user_id" gorm:"index;not null"`
	OrgId       int       `json:"org_id" gorm:"index;default:0"`
	Username    string    `json:"username" gorm:"type:varchar(50)"`
	OrderNo     string    `json:"order_no" gorm:"type:varchar(64);index;not null"`
	Quota       int64     `json:"quota" gorm:"type:bigint;not null"`
	BeforeQuota int64     `json:"before_quota" gorm:"type:bigint"`
	AfterQuota  int64     `json:"after_quota" gorm:"type:bigint"`
	Remark      string    `json:"remark" gorm:"type:varchar(255)"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime;index"`
}

func (RechargeRecord) TableName() string {
	return "recharge_records"
}

// CreateRechargeRecord 创建充值记录
func CreateRechargeRecord(record *RechargeRecord) error {
	return DB.Create(record).Error
}

// GetUserRechargeRecords 获取用户充值记录
func GetUserRechargeRecords(userId int, startIdx int, num int) ([]*RechargeRecord, error) {
	var records []*RechargeRecord
	err := DB.Where("user_id = ?", userId).
		Where("org_id = 0 OR org_id IS NULL").
		Order("created_at desc").
		Limit(num).
		Offset(startIdx).
		Find(&records).Error
	return records, err
}
