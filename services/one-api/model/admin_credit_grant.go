package model

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"time"
)

// AdminCreditGrant is an immutable audit receipt committed together with the user's credit grant.
type AdminCreditGrant struct {
	Reference    string `gorm:"primaryKey;size:64"`
	UserId       int    `gorm:"index"`
	ActorId      int    `gorm:"index"`
	Amount       int64
	BalanceAfter int64
	Remark       string `gorm:"type:text"`
	ExpiresAt    *time.Time
	CreatedAt    time.Time
}

func GrantAdminCredits(userId, actorId int, amount int64, remark string, ttl *time.Duration) error {
	reference := uuid.NewString()
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := AddUserTimedQuotaTx(tx, userId, amount, TimedQuotaSourceAdmin, reference, ttl); err != nil {
			return err
		}
		var user User
		if err := tx.Select("quota").First(&user, userId).Error; err != nil {
			return err
		}
		var expiry *time.Time
		if ttl != nil {
			at := time.Now().Add(*ttl)
			expiry = &at
		}
		return tx.Create(&AdminCreditGrant{Reference: reference, UserId: userId, ActorId: actorId, Amount: amount, BalanceAfter: user.Quota, Remark: remark, ExpiresAt: expiry}).Error
	})
	if err == nil {
		InvalidateUserAccountCache(userId)
	}
	return err
}
