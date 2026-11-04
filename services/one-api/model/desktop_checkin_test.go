package model

import (
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDesktopCheckinPeriod(t *testing.T) {
	s := DesktopCheckinStatus{Enabled: true, IntervalDays: 2}
	last := "2026-11-03"
	for _, tc := range []struct {
		at   string
		want bool
	}{{"2026-11-04T15:59:59Z", false}, {"2026-11-04T16:00:00Z", true}} {
		now, _ := time.Parse(time.RFC3339, tc.at)
		got := checkinAvailability(s, last, now)
		if got.CanClaim != tc.want || got.NextDate != "2026-11-05" {
			t.Fatalf("%s: %+v", tc.at, got)
		}
	}
}
func TestDesktopCheckinAtomicGrant(t *testing.T) {
	oldDB, oldUnit := DB, config.QuotaPerUnit
	config.OptionMapRWMutex.Lock()
	if config.OptionMap == nil {
		config.OptionMap = map[string]string{}
	}
	old := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"operations","creditRewards":{"login":{"enabled":true,"amount":100,"intervalDays":1}}}`
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		DB = oldDB
		config.QuotaPerUnit = oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap["SystemDeploymentSettings"] = old
		config.OptionMapRWMutex.Unlock()
	})
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	DB = db
	config.QuotaPerUnit = 1000
	if err = db.AutoMigrate(&User{}, &UserTimedQuota{}, &DesktopCheckinState{}, &DesktopCheckinReceipt{}); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&User{Id: 901, Username: "checkin-user"}).Error; err != nil {
		t.Fatal(err)
	}
	var success atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ClaimDesktopCheckin(901) == nil {
				success.Add(1)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 1 {
		t.Fatalf("claims: %d", success.Load())
	}
	var user User
	db.First(&user, 901)
	if user.Quota != 100000 || user.TimedQuotaTotal != 100000 {
		t.Fatalf("balance: %+v", user)
	}
	var receipt DesktopCheckinReceipt
	db.First(&receipt)
	if receipt.Amount != 100000 || receipt.BalanceAfter != 100000 {
		t.Fatal(receipt)
	}
	var count int64
	db.Model(&UserTimedQuota{}).Count(&count)
	if count != 1 {
		t.Fatal(count)
	}
	state, err := GetDesktopCheckinStatus(901)
	if err != nil || state.CanClaim {
		t.Fatalf("status: %+v %v", state, err)
	}
	// Failed users roll back the eligibility marker and can retry after account creation.
	if ClaimDesktopCheckin(902) == nil {
		t.Fatal("missing account granted")
	}
	db.Model(&DesktopCheckinState{}).Where("user_id = ?", 902).Count(&count)
	if count != 0 {
		t.Fatal("claim marker committed on failure")
	}
	config.OptionMapRWMutex.Lock()
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"operations","creditRewards":{"login":{"enabled":false,"amount":100,"intervalDays":1}}}`
	config.OptionMapRWMutex.Unlock()
	state, err = GetDesktopCheckinStatus(901)
	if err != nil || state.Enabled || ClaimDesktopCheckin(901) == nil {
		t.Fatal("disabled policy accepted")
	}
}
