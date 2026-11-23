package model

import (
	"errors"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"gorm.io/gorm"
)

func TestCreditLedgerAtomicBalanceChanges(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&User{}, &CreditLedger{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&User{Id: 1, Username: "alice", AccessToken: "alice", AffCode: "alice", Quota: 100})
	db.Create(&User{Id: 2, Username: "bob", AccessToken: "bob", AffCode: "bob", Quota: 50})
	if err = RegisterCreditLedger(db); err != nil {
		t.Fatal(err)
	}
	update := WithCreditAudit(db, CreditAuditInfo{ActorID: 9, ActorName: "admin", Source: "admin", Reference: "grant-1"})
	if err = update.Model(&User{}).Where("id = ?", 1).Update("quota", gorm.Expr("quota + ?", 25)).Error; err != nil {
		t.Fatal(err)
	}
	// Non-balance updates must never duplicate ledger rows.
	db.Model(&User{}).Where("id = ?", 1).Update("used_quota", 10)
	db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", 1).Update("quota", 0).Error; err != nil {
			t.Fatal(err)
		}
		return errors.New("rollback")
	})
	// Primary-key model and multi-user updates must both be covered.
	if err = db.Model(&User{Id: 2}).Update("quota", 40).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&User{}).Where("id IN ?", []int{1, 2}).Update("quota", gorm.Expr("quota + ?", 5)).Error; err != nil {
		t.Fatal(err)
	}
	var rows []CreditLedger
	if err = db.Order("id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 4 {
		t.Fatalf("expected 4 real mutations, got %+v", rows)
	}
	first := rows[0]
	if first.UserID != 1 || first.Username != "alice" || first.Delta != 25 || *first.BalanceBefore != 100 || *first.BalanceAfter != 125 || first.ActorID != 9 || first.Reference != "grant-1" {
		t.Fatalf("audit lost: %+v", first)
	}
	// An audit write failure must roll back the balance too.
	db.Migrator().DropTable(&CreditLedger{})
	if err = db.Model(&User{}).Where("id = ?", 1).Update("quota", 0).Error; err == nil {
		t.Fatal("unaudited mutation accepted")
	}
	var user User
	db.First(&user, 1)
	if user.Quota != 130 {
		t.Fatalf("failed audit changed balance: %d", user.Quota)
	}
}

func TestCreditLedgerOrganizationAndOpening(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&User{}, &Organization{}, &CreditLedger{}); err != nil {
		t.Fatal(err)
	}
	if err = RegisterCreditLedger(db); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&Organization{Id: 3, Name: "规划单位", Code: "org-3", Quota: 1000}).Error; err != nil {
		t.Fatal(err)
	}
	if err = WithCreditAudit(db, CreditAuditInfo{ActorID: 7, ActorName: "alice", Source: "model_reserve", Reference: "request-3"}).Model(&Organization{}).Where("id = ?", 3).Update("used_quota", 250).Error; err != nil {
		t.Fatal(err)
	}
	var rows []CreditLedger
	db.Order("id").Find(&rows)
	if len(rows) != 2 || rows[0].Delta != 1000 || rows[1].Delta != -250 || rows[1].OrgID != 3 || rows[1].UserID != 0 || *rows[1].BalanceAfter != 750 || rows[1].ActorID != 7 {
		t.Fatalf("incorrect enterprise audit: %+v", rows)
	}
}

func TestCreditLedgerSaveAndSelectedUpdates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&User{}, &CreditLedger{}); err != nil {
		t.Fatal(err)
	}
	user := User{Username: "alice", Quota: 100}
	db.Create(&user)
	if err = RegisterCreditLedger(db); err != nil {
		t.Fatal(err)
	}
	user.Quota = 40
	if err = db.Save(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&user).Select("display_name").Updates(map[string]interface{}{"quota": 99, "display_name": "Alice"}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&user).Select("quota").Updates(map[string]interface{}{"quota": 30}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&[]User{user}).Update("quota", 20).Error; err != nil {
		t.Fatal(err)
	}
	var rows []CreditLedger
	db.Order("id").Find(&rows)
	if len(rows) != 3 || rows[0].Delta != -60 || rows[1].Delta != -10 || rows[2].Delta != -10 {
		t.Fatalf("save or selected updates lost: %+v", rows)
	}
}

func TestCreditLedgerBatchGrantIncludesEveryMatchedUser(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldSQLite := DB, common.UsingSQLite
	DB = db
	common.UsingSQLite = true
	t.Cleanup(func() { DB = oldDB; common.UsingSQLite = oldSQLite })
	if err = db.AutoMigrate(&User{}, &UserTimedQuota{}, &CreditLedger{}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"alice", "bob"} {
		if err = db.Create(&User{Username: name, AccessToken: name, AffCode: name, Group: "planning", Role: RoleCommonUser, Status: UserStatusEnabled}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err = RegisterCreditLedger(db); err != nil {
		t.Fatal(err)
	}
	result, err := BatchAddUserTimedQuota(UserTimedQuotaBatchFilter{Groups: []string{"planning"}}, 1000, "batch-1", nil, 9)
	if err != nil {
		t.Fatal(err)
	}
	if result.Matched != 2 {
		t.Fatal(result)
	}
	var rows []CreditLedger
	db.Order("id").Find(&rows)
	if len(rows) != 2 {
		t.Fatal(rows)
	}
	for _, row := range rows {
		if row.Delta != 1000 || row.ActorID != 9 || row.Source != "admin" || row.Reference != "batch-1" || *row.BalanceAfter != 1000 {
			t.Fatalf("batch audit lost: %+v", row)
		}
	}
}

func TestCreditLedgerHistoryIdempotentAndDoesNotInventBalances(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	oldDB, oldLog := DB, LOG_DB
	DB, LOG_DB = db, db
	t.Cleanup(func() { DB, LOG_DB = oldDB, oldLog })
	if err = db.AutoMigrate(&User{}, &Organization{}, &CreditLedger{}, &CreditLedgerMigration{}, &AdminCreditGrant{}, &DesktopCheckinReceipt{}, &UserTimedQuota{}, &OrgTimedQuota{}, &BillingTask{}, &KnowledgeCreditReceipt{}, &Log{}); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-24 * time.Hour)
	db.Create(&User{Id: 1, Username: "alice"})
	db.Create(&AdminCreditGrant{Reference: "grant-a", UserId: 1, Amount: 1000, BalanceAfter: 1000, CreatedAt: old})
	db.Create(&UserTimedQuota{UserId: 1, Amount: 1000, Remaining: 500, Source: "admin", SourceRef: "grant-a", CreatedAt: old})
	db.Create(&BillingTask{ID: "task-a", UserID: 1, RequestID: "req-a", Kind: "skill", State: "succeeded", Quota: 200, BalanceAfter: 800, CreatedAt: old, SettledAt: &old})
	db.Create(&Log{UserId: 1, Type: LogTypeConsume, Quota: 300, ModelName: "qwen", CreatedAt: old.Unix()})
	for i := 0; i < 2; i++ {
		if err = ImportCreditLedgerHistory(); err != nil {
			t.Fatal(err)
		}
	}
	var rows []CreditLedger
	db.Order("id").Find(&rows)
	if len(rows) != 3 {
		t.Fatalf("duplicate or missing historical records: %+v", rows)
	}
	var total int64
	for _, row := range rows {
		total += row.Delta
		if !row.Historical {
			t.Fatal("missing history marker")
		}
		if row.Origin == "task:task-a" && row.BalanceBefore != nil {
			t.Fatal("invented pre-reservation balance")
		}
	}
	if total != 500 {
		t.Fatal(total)
	}
}
