package model

import (
	"time"
)

// 发票状态常量
const (
	InvoiceStatusNone     = "NONE"     // 未开票
	InvoiceStatusApplying = "APPLYING" // 申请中
	InvoiceStatusIssued   = "ISSUED"   // 已开票
	InvoiceStatusFailed   = "FAILED"   // 开票失败
	InvoiceStatusCanceled = "CANCELED" // 已取消
)

// Invoice 发票模型（对应 invoices 表）
type Invoice struct {
	Id            string     `json:"id" gorm:"column:id;type:varchar(32);primaryKey"`
	OrderId       int        `json:"order_id" gorm:"column:order_id;not null;index"`
	OrderNo       string     `json:"order_no" gorm:"column:order_no;type:varchar(64);not null;index"`
	UserId        int        `json:"user_id" gorm:"column:user_id;not null;index"`
	InvoiceType   string     `json:"invoice_type" gorm:"column:invoice_type;type:varchar(30);not null"`
	InvoiceLine   string     `json:"invoice_line" gorm:"column:invoice_line;type:varchar(32);not null;default:pc"`
	BuyerName     string     `json:"buyer_name" gorm:"column:buyer_name;type:varchar(128);not null"`
	BuyerTaxNum   string     `json:"buyer_tax_num" gorm:"column:buyer_tax_num;type:varchar(64)"`
	BuyerTel      string     `json:"buyer_tel" gorm:"column:buyer_tel;type:varchar(128)"`
	BuyerAddress  string     `json:"buyer_address" gorm:"column:buyer_address;type:varchar(256)"`
	BankName      string     `json:"bank_name" gorm:"column:bank_name;type:varchar(255)"`
	BankAccount   string     `json:"bank_account" gorm:"column:bank_account;type:varchar(64)"`
	BuyerPhone    string     `json:"buyer_phone" gorm:"column:buyer_phone;type:varchar(32)"`
	Email         string     `json:"email" gorm:"column:email;type:varchar(128);not null"`
	InvoiceAmount int64      `json:"invoice_amount" gorm:"column:invoice_amount;not null"`
	TaxRate       float64    `json:"tax_rate" gorm:"column:tax_rate;type:decimal(5,4)"`
	TaxAmount     int64      `json:"tax_amount" gorm:"column:tax_amount"`
	InvoiceStatus string     `json:"invoice_status" gorm:"column:invoice_status;type:varchar(20);not null;default:APPLYING;index"`
	InvoiceUrl    string     `json:"invoice_url" gorm:"column:invoice_url;type:text"`
	SerialNum     string     `json:"serial_num" gorm:"column:serial_num;type:varchar(100)"`
	Remark        string     `json:"remark" gorm:"column:remark;type:varchar(255)"`
	Detail        string     `json:"detail" gorm:"column:detail;type:text"`
	Request       string     `json:"request" gorm:"column:request;type:text"`
	ApplyTime     *time.Time `json:"apply_time" gorm:"column:apply_time"`
	IssueTime     *time.Time `json:"issue_time" gorm:"column:issue_time"`
	CreatedAt     time.Time  `json:"created_at" gorm:"column:created_at;autoCreateTime"`
	UpdatedAt     time.Time  `json:"updated_at" gorm:"column:updated_at;autoUpdateTime"`
}

func (Invoice) TableName() string {
	return "invoices"
}

// CreateInvoice 创建发票记录
func CreateInvoice(invoice *Invoice) error {
	return DB.Create(invoice).Error
}

// GetInvoiceByOrderNo 根据订单号查询最新发票
func GetInvoiceByOrderNo(orderNo string, userId int) (*Invoice, error) {
	var invoice Invoice
	err := DB.Where("order_no = ? AND user_id = ?", orderNo, userId).
		Order("apply_time DESC").
		First(&invoice).Error
	return &invoice, err
}

// GetInvoiceById 根据ID查询发票
func GetInvoiceById(id string) (*Invoice, error) {
	var invoice Invoice
	err := DB.Where("id = ?", id).First(&invoice).Error
	return &invoice, err
}

// GetInvoiceByOrderNoOnly 根据订单号查询发票（不限用户，用于回调）
func GetInvoiceByOrderNoOnly(orderNo string) (*Invoice, error) {
	var invoice Invoice
	err := DB.Where("order_no = ?", orderNo).
		Order("apply_time DESC").
		First(&invoice).Error
	return &invoice, err
}

// UpdateInvoiceStatus 更新发票状态
func UpdateInvoiceStatus(id string, updates map[string]interface{}) error {
	return DB.Model(&Invoice{}).Where("id = ?", id).Updates(updates).Error
}

// UpdateOrderInvoiceStatus 更新订单的发票状态
func UpdateOrderInvoiceStatus(orderNo string, invoiceStatus string) error {
	return DB.Model(&Order{}).Where("order_no = ?", orderNo).
		Update("invoice_status", invoiceStatus).Error
}
