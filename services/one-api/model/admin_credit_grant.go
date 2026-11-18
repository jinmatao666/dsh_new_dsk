package model

import (
	"errors"
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/config"
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
	if config.CreditsDisabled() {
		return errors.New("积分机制已关闭，暂停发放积分")
	}
	reference := uuid.NewString()
	err := DB.Transaction(func(tx *gorm.DB) error {
		return grantCreditsTx(tx, userId, actorId, amount, remark, ttl, TimedQuotaSourceAdmin, reference)
	})
	if err == nil {
		InvalidateUserAccountCache(userId)
	}
	return err
}

// grantCreditsTx commits the common issuance ledger and audit receipt in an existing transaction.
func grantCreditsTx(tx *gorm.DB, userId, actorId int, amount int64, remark string, ttl *time.Duration, source, reference string) error {
	if err := AddUserTimedQuotaTx(tx, userId, amount, source, reference, ttl); err != nil {
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
}
