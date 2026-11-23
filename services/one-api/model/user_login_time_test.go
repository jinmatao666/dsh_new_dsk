package model

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestRecordSuccessfulLogin(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	if err := db.AutoMigrate(&User{}); err != nil {
		t.Fatal(err)
	}
	user := User{Username: "login-time"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	before := time.Now().Unix()
	RecordSuccessfulLogin(user.Id)
	if err := db.First(&user, user.Id).Error; err != nil {
		t.Fatal(err)
	}
	if user.LastLoginAt == nil || *user.LastLoginAt < before || *user.LastLoginAt > time.Now().Unix() || user.LastActiveAt != nil {
		t.Fatalf("unexpected timestamps: login=%v activity=%v", user.LastLoginAt, user.LastActiveAt)
	}
}
