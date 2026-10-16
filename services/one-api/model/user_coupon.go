package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

const (
	CouponTypeDiscount  = "discount"
	CouponTypeDeduction = "deduction"

	CouponStatusUnused  = "unused"
	CouponStatusUsed    = "used"
	CouponStatusExpired = "expired"
)

type UserCoupon struct {
	Id          int        `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId      int        `json:"user_id" gorm:"index;not null;comment:用户ID"`
	CouponType  string     `json:"coupon_type" gorm:"type:varchar(20);not null;comment:优惠券类型 discount/deduction"`
	CouponValue float64    `json:"coupon_value" gorm:"type:decimal(10,4);not null;comment:折扣系数(0-1)或抵扣金额(元)"`
	Status      string     `json:"status" gorm:"type:varchar(20);default:'unused';index;comment:状态"`
	Source      string     `json:"source" gorm:"type:varchar(64);comment:来源标识"`
	ExpiresAt   *time.Time `json:"expires_at" gorm:"comment:过期时间,null=永久"`
	CreatedAt   time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (UserCoupon) TableName() string {
	return "user_coupons"
}

// couponLogContent 生成优惠券变更的账户动态文案
func couponLogContent(couponType string, couponValue float64) string {
	if couponType == CouponTypeDiscount {
		return fmt.Sprintf("获得 %.1f 折折扣券", couponValue*10)
	}
	return fmt.Sprintf("获得 ¥%.2f 抵扣券", couponValue)
}

// AddUserCouponTx 在事务内为单个用户发放一张优惠券
func AddUserCouponTx(tx *gorm.DB, userId int, couponType string, couponValue float64, source string, expiresAt *time.Time) error {
	coupon := UserCoupon{
		UserId:      userId,
		CouponType:  couponType,
		CouponValue: couponValue,
		Status:      CouponStatusUnused,
		Source:      source,
		ExpiresAt:   expiresAt,
	}
	if err := tx.Create(&coupon).Error; err != nil {
		return err
	}
	// 写账户动态日志（同事务，保证回滚一致性）
	return recordLogTx(tx, userId, LogTypeSystem, couponLogContent(couponType, couponValue))
}

func BatchAddUserCoupons(userIds []int, couponType string, couponValue float64, source string, expiresAt *time.Time) error {
	if len(userIds) == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		coupons := make([]UserCoupon, 0, len(userIds))
		for _, uid := range userIds {
			coupons = append(coupons, UserCoupon{
				UserId:      uid,
				CouponType:  couponType,
				CouponValue: couponValue,
				Status:      CouponStatusUnused,
				Source:      source,
				ExpiresAt:   expiresAt,
			})
		}
		if err := tx.CreateInBatches(&coupons, 100).Error; err != nil {
			return err
		}
		// 为每个用户写一条账户动态日志
		content := couponLogContent(couponType, couponValue)
		for _, uid := range userIds {
			if err := recordLogTx(tx, uid, LogTypeSystem, content); err != nil {
				return err
			}
		}
		return nil
	})
}
