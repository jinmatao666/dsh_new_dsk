package model

import (
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"testing"
)

func TestRegistrationCreditAndAdminAudit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	oldDB, oldUnit := DB, config.QuotaPerUnit
	DB = db
	config.QuotaPerUnit = 1000
	config.OptionMapRWMutex.Lock()
	if config.OptionMap == nil {
		config.OptionMap = map[string]string{}
	}
	old := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"operations","creditRewards":{"registration":{"enabled":true,"amount":2000}}}`
	config.OptionMapRWMutex.Unlock()
	defer func() {
		DB = oldDB
		config.QuotaPerUnit = oldUnit
		config.OptionMapRWMutex.Lock()
		config.OptionMap["SystemDeploymentSettings"] = old
		config.OptionMapRWMutex.Unlock()
	}()
	if err = db.AutoMigrate(&User{}, &UserTimedQuota{}, &AdminCreditGrant{}); err != nil {
		t.Fatal(err)
	}
	owned, amount, err := RegistrationCreditRule()
	if err != nil || !owned || amount != 2000000 {
		t.Fatalf("%v %d %v", owned, amount, err)
	}
	user := User{Username: "reward-user"}
	if err = db.Transaction(func(tx *gorm.DB) error {
		if e := tx.Create(&user).Error; e != nil {
			return e
		}
		return grantRegistrationCreditTx(tx, &user, amount)
	}); err != nil {
		t.Fatal(err)
	}
	var got User
	db.First(&got, user.Id)
	if got.Quota != amount {
		t.Fatal(got.Quota)
	}
	if err = GrantAdminCredits(user.Id, 7, 100000, "customer support", nil); err != nil {
		t.Fatal(err)
	}
	var receipt AdminCreditGrant
	if err = db.First(&receipt).Error; err != nil || receipt.ActorId != 7 || receipt.BalanceAfter != 2100000 || receipt.Remark != "customer support" {
		t.Fatalf("%+v %v", receipt, err)
	}
	// Receipt failure rolls the grant back, including its ledger row.
	db.Migrator().DropTable(&AdminCreditGrant{})
	if GrantAdminCredits(user.Id, 7, 50000, "must rollback", nil) == nil {
		t.Fatal("missing receipt accepted")
	}
	db.First(&got, user.Id)
	if got.Quota != 2100000 {
		t.Fatal("grant without audit committed")
	}
	var count int64
	db.Model(&UserTimedQuota{}).Where("user_id = ?", user.Id).Count(&count)
	if count != 2 {
		t.Fatal(count)
	}
	config.OptionMapRWMutex.Lock()
	config.OptionMap["SystemDeploymentSettings"] = `{"edition":"operations","creditRewards":{"registration":{"enabled":false,"amount":2000}}}`
	config.OptionMapRWMutex.Unlock()
	owned, amount, err = RegistrationCreditRule()
	if !owned || amount != 0 || err != nil {
		t.Fatal("disabled registration reward did not override trial gift")
	}
}
