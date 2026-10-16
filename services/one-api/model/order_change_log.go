package model

import "time"

// OrderChangeLog 改单流水（完整快照，可审计）。
// 每次管理员改单写一行，记录改单前后的完整套餐/积分/金额快照及操作管理员。
//
// 与 orders 表（就地改写，只保留最新状态）互补：流水表保留每次变更的历史。
type OrderChangeLog struct {
	Id           int64     `json:"id" gorm:"primaryKey"`
	OrderNo      string    `json:"order_no" gorm:"type:varchar(64);index;not null;comment:订单号"`
	UserId       int       `json:"user_id" gorm:"index;not null;comment:用户ID"`
	OrgId        *int      `json:"org_id" gorm:"column:org_id;index;comment:企业ID(个人订单为空)"`
	Username     string    `json:"username" gorm:"type:varchar(50);comment:用户名"`
	OrgName      string    `json:"org_name" gorm:"type:varchar(100);comment:企业名"`
	FromPackage  string    `json:"from_package" gorm:"type:varchar(50);comment:原套餐名"`
	ToPackage    string    `json:"to_package" gorm:"type:varchar(50);comment:新套餐名"`
	FromQuota    int64     `json:"from_quota" gorm:"type:bigint;comment:原套餐额度"`
	ToQuota      int64     `json:"to_quota" gorm:"type:bigint;comment:新套餐额度"`
	FromAmount   int       `json:"from_amount" gorm:"comment:原订单实付-分"`
	ToAmount     int       `json:"to_amount" gorm:"comment:新套餐价-分"`
	UsedQuota    int64     `json:"used_quota" gorm:"type:bigint;comment:改单时已消费额度"`
	NewRemaining int64     `json:"new_remaining" gorm:"type:bigint;comment:转换后剩余额度"`
	DeltaQuota   int64     `json:"delta_quota" gorm:"type:bigint;comment:余额变动"`
	RefundAmount int       `json:"refund_amount" gorm:"comment:建议退款-分"`
	OperatorId   int       `json:"operator_id" gorm:"index;comment:操作管理员ID"`
	OperatorName string    `json:"operator_name" gorm:"type:varchar(50);comment:操作管理员用户名"`
	CreatedAt    time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
}

func (OrderChangeLog) TableName() string {
	return "order_change_logs"
}

// GetOrderChangeLogs 分页获取改单流水（管理员，按时间倒序）。
func GetOrderChangeLogs(startIdx, num int) ([]*OrderChangeLog, error) {
	var logs []*OrderChangeLog
	err := DB.Order("created_at DESC").Limit(num).Offset(startIdx).Find(&logs).Error
	return logs, err
}

// SearchOrderChangeLogs 按订单号 / 用户名 / 企业名搜索改单流水。
func SearchOrderChangeLogs(keyword string, num int) ([]*OrderChangeLog, error) {
	var logs []*OrderChangeLog
	like := "%" + keyword + "%"
	err := DB.Where("order_no LIKE ? OR username LIKE ? OR org_name LIKE ?", like, like, like).
		Order("created_at DESC").Limit(num).Find(&logs).Error
	return logs, err
}
