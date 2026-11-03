package model

import (
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestTokenCreditQuotaReservationRefundAndInsufficientFunds(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldSQLite, oldRedis := DB, common.UsingSQLite, common.RedisEnabled
	DB = db
	common.UsingSQLite = true
	common.RedisEnabled = false
	defer func() { DB = oldDB; common.UsingSQLite = oldSQLite; common.RedisEnabled = oldRedis }()
	if err = db.AutoMigrate(&User{}, &UserTimedQuota{}, &Token{}); err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(time.Hour)
	db.Create(&User{Id: 1, Username: "test", Quota: 1500, TimedQuotaTotal: 1500})
	db.Create(&UserTimedQuota{Id: 1, UserId: 1, Amount: 1000, Remaining: 1000, Source: TimedQuotaSourceAdmin, ExpiresAt: &expires})
	db.Create(&UserTimedQuota{Id: 2, UserId: 1, Amount: 500, Remaining: 500, Source: TimedQuotaSourceAdmin})
	db.Create(&Token{Id: 1, UserId: 1, Key: "credit-test", RemainQuota: 1500})
	reserved, err := ChangeTokenCreditQuota(1, 1, 800, nil)
	if err != nil {
		t.Fatal(err)
	}
	if reserved[1] != 800 {
		t.Fatalf("expiry order lost: %v", reserved)
	}
	if _, err = ChangeTokenCreditQuota(1, 1, -446, reserved); err != nil {
		t.Fatal(err)
	}
	var user User
	var token Token
	var row UserTimedQuota
	db.First(&user, 1)
	db.First(&token, 1)
	db.First(&row, 1)
	if user.Quota != 1146 || token.RemainQuota != 1146 || token.UsedQuota != 354 || row.Remaining != 646 || row.ExpiresAt == nil {
		t.Fatalf("incorrect settlement: user=%d token=%+v row=%+v", user.Quota, token, row)
	}
	if _, err = ChangeTokenCreditQuota(1, 1, 2000, nil); err == nil {
		t.Fatal("insufficient funds accepted")
	}
	db.First(&user, 1)
	db.First(&token, 1)
	if user.Quota != 1146 || token.RemainQuota != 1146 {
		t.Fatal("failed debit partially changed balances")
	}
	if _, err = ChangeTokenCreditQuota(1, 1, -801, reserved); err == nil {
		t.Fatal("refund exceeds reservation")
	}
	db.First(&user, 1)
	if user.Quota != 1146 {
		t.Fatal("failed refund partially changed balance")
	}
}
