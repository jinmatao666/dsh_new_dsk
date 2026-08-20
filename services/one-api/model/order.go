package model

import (
	"errors"
	"time"
)

const (
	OrderStatusPending   = "pending"
	OrderStatusPaid      = "paid"
	OrderStatusCancelled = "cancelled"
	OrderStatusExpired   = "expired"
	OrderStatusRefunded  = "refunded"
)

const (
	PayTypeWechat = "wechat"
	PayTypeAlipay = "alipay"
)

type Order struct {
	Id             int        `json:"id" gorm:"primaryKey;comment:订单ID"`
	OrderNo        string     `json:"order_no" gorm:"uniqueIndex;type:varchar(64);not null;comment:订单号"`
	UserId         int        `json:"user_id" gorm:"index;not null;comment:用户ID"`
	Username       string     `json:"username" gorm:"type:varchar(50);comment:用户名"`
	PackageId      int        `json:"package_id" gorm:"not null;comment:套餐ID"`
	PackageName    string     `json:"package_name" gorm:"type:varchar(50);comment:套餐名称"`
	Amount         int        `json:"amount" gorm:"not null;comment:订单金额-分"`
	OriginalAmount int        `json:"original_amount" gorm:"default:0;comment:折抵前原价-分"`
	DiscountAmount int        `json:"discount_amount" gorm:"default:0;comment:升级折抵金额-分"`
	Quota          int64      `json:"quota" gorm:"type:bigint;not null;comment:充值额度"`
	BillingCycle   string     `json:"billing_cycle" gorm:"type:varchar(10);default:once;comment:订阅周期"`
	SubscriptionId int        `json:"subscription_id" gorm:"default:0;comment:关联订阅ID"`
	PayType        string     `json:"pay_type" gorm:"type:varchar(20);not null;default:'wechat';comment:支付方式"`
	Status         string     `json:"status" gorm:"type:varchar(20);not null;default:'pending';index;comment:订单状态"`
	TransactionId  string     `json:"transaction_id" gorm:"type:varchar(64);comment:第三方交易号"`
	CodeUrl        string     `json:"code_url" gorm:"type:varchar(512);comment:支付二维码链接"`
	InvoiceStatus  string     `json:"invoice_status" gorm:"type:varchar(20);default:NONE;comment:发票状态"`
	PaidAt         *time.Time `json:"paid_at" gorm:"comment:支付时间"`
	ExpiredAt      *time.Time `json:"expired_at" gorm:"comment:过期时间"`
	CreatedAt      time.Time  `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt      time.Time  `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
	OrgId          *int       `json:"org_id" gorm:"column:org_id;comment:企业ID"`
	InviteCode     string     `json:"invite_code" gorm:"type:varchar(32);comment:邀请码"`
	InviteDiscount int        `json:"invite_discount" gorm:"default:0;comment:邀请码抵扣金额-分"`
}

func (Order) TableName() string {
	return "orders"
}

// CreateOrder 创建订单
func CreateOrder(order *Order) error {
	if order.OrderNo == "" || order.UserId == 0 || order.PackageId == 0 {
		return errors.New("订单信息不完整")
	}
	return DB.Create(order).Error
}

// GetOrderByOrderNo 根据订单号查询订单
func GetOrderByOrderNo(orderNo string) (*Order, error) {
	var order Order
	err := DB.Where("order_no = ?", orderNo).First(&order).Error
	return &order, err
}

// GetOrderById 根据ID查询订单
func GetOrderById(id int) (*Order, error) {
	var order Order
	err := DB.Where("id = ?", id).First(&order).Error
	return &order, err
}

// UpdateOrderStatus 更新订单状态
func UpdateOrderStatus(orderNo string, status string, transactionId string, paidAt *time.Time) error {
	updates := map[string]interface{}{
		"status": status,
	}
	if transactionId != "" {
		updates["transaction_id"] = transactionId
	}
	if paidAt != nil {
		updates["paid_at"] = paidAt
	}
	return DB.Model(&Order{}).Where("order_no = ?", orderNo).Updates(updates).Error
}

// GetUserOrders 获取用户订单列表
func GetUserOrders(userId int, startIdx int, num int) ([]*Order, error) {
	var orders []*Order
	err := DB.Where("user_id = ?", userId).
		Order("created_at desc").
		Limit(num).
		Offset(startIdx).
		Find(&orders).Error
	return orders, err
}

// GetAllOrders 获取所有订单（管理员）
func GetAllOrders(startIdx int, num int) ([]*Order, error) {
	var orders []*Order
	err := DB.Order("created_at desc").
		Limit(num).
		Offset(startIdx).
		Find(&orders).Error
	return orders, err
}

// MarkOrderRefunded 把已支付订单翻转为已退积分,带 status='paid' 守卫保证幂等.
// 返回受影响行数:0 表示订单非 paid(已退过/状态不符),调用方据此拒绝重复退款.
func MarkOrderRefunded(orderNo string) (int64, error) {
	res := DB.Model(&Order{}).
		Where("order_no = ? AND status = ?", orderNo, OrderStatusPaid).
		Update("status", OrderStatusRefunded)
	return res.RowsAffected, res.Error
}
