package model

import (
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestUnifiedBillingReservationSettlement(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldSQLite, oldRedis := DB, common.UsingSQLite, common.RedisEnabled
	DB = db
	common.UsingSQLite = true
	common.RedisEnabled = false
	config.OptionMapRWMutex.Lock()
	oldMap := config.OptionMap
	if config.OptionMap == nil {
		config.OptionMap = map[string]string{}
	}
	oldSettings := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"operational","creditsEnabled":true}`
	config.OptionMapRWMutex.Unlock()
	defer func() {
		DB = oldDB
		common.UsingSQLite = oldSQLite
		common.RedisEnabled = oldRedis
		config.OptionMapRWMutex.Lock()
		config.OptionMap["SystemDeploymentSettings"] = oldSettings
		config.OptionMap = oldMap
		config.OptionMapRWMutex.Unlock()
	}()
	if err := db.AutoMigrate(&User{}, &UserTimedQuota{}, &BillingTask{}, &BillingRule{}, &BusinessBillingContext{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&User{Id: 1, Username: "billing-user", Quota: 1000, TimedQuotaTotal: 1000})
	expires := time.Now().Add(time.Hour)
	db.Create(&UserTimedQuota{Id: 1, UserId: 1, Amount: 1000, Remaining: 1000, Source: TimedQuotaSourceAdmin, ExpiresAt: &expires})
	db.Create(&BillingRule{ID: "rule", Kind: "skill", ItemID: "convert", Action: "execute", UnitQuota: 100, Enabled: true, Version: 1})
	request := BillingTask{Kind: "skill", ItemID: "convert", Action: "execute", Quantity: 2, RequestID: "request-1", Version: 1}
	task, secret, err := ReserveBillingTask(1, request)
	if err != nil {
		t.Fatal(err)
	}
	again, _, err := ReserveBillingTask(1, request)
	if err != nil || again.ID != task.ID {
		t.Fatal("replay", err)
	}
	changed := request
	changed.Quantity = 3
	if _, _, err := ReserveBillingTask(1, changed); err == nil {
		t.Fatal("conflicting replay accepted")
	}
	var user User
	db.First(&user, 1)
	if user.Quota != 800 {
		t.Fatal("duplicate debit", user.Quota)
	}
	if _, err := SettleBillingTask(task.ID, "wrong", "succeeded", false); err == nil {
		t.Fatal("foreign capability")
	}
	if _, err := SettleBillingTask(task.ID, secret, "succeeded", false); err != nil {
		t.Fatal(err)
	}
	if _, err := SettleBillingTask(task.ID, secret, "succeeded", false); err != nil {
		t.Fatal(err)
	}
	db.First(&user, 1)
	if user.UsedQuota != 200 || user.Quota != 800 {
		t.Fatal("settlement changed twice", user)
	}
	if _, err := SettleBillingTask(task.ID, secret, "failed", false); err == nil {
		t.Fatal("terminal refund accepted")
	}
	request.RequestID = "request-2"
	failed, key, err := ReserveBillingTask(1, request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SettleBillingTask(failed.ID, key, "failed", false); err != nil {
		t.Fatal(err)
	}
	db.First(&user, 1)
	if user.Quota != 800 {
		t.Fatal("refund", user.Quota)
	}
	request.RequestID = "request-3"
	expired, _, err := ReserveBillingTask(1, request)
	if err != nil {
		t.Fatal(err)
	}
	db.Model(&expired).Update("expires_at", time.Now().Add(-time.Minute))
	if err := ExpireBillingTasks(); err != nil {
		t.Fatal(err)
	}
	db.First(&user, 1)
	if user.Quota != 800 {
		t.Fatal("expiry", user.Quota)
	}
	request.RequestID = "request-4"
	request.Quantity = 1000
	if _, _, err := ReserveBillingTask(1, request); err == nil {
		t.Fatal("insufficient balance accepted")
	}
	request.Quantity = 1
	request.Version = 2
	if _, _, err := ReserveBillingTask(1, request); err == nil {
		t.Fatal("stale quote accepted")
	}
}
