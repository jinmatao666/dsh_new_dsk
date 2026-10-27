package model

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestDesktopUpdateMigrationAllowsSameVersionAndPreservesRecords(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "updates.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	if err := db.AutoMigrate(&DesktopUpdate{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX desktop_update_version ON desktop_updates (platform, version)").Error; err != nil {
		t.Fatal(err)
	}
	first := DesktopUpdate{ID: "first", Platform: "windows-x86_64", Version: "1.2.0"}
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := migrateDesktopUpdates(db); err != nil {
			t.Fatal(err)
		}
	}
	if db.Migrator().HasIndex(&DesktopUpdate{}, "desktop_update_version") {
		t.Fatal("legacy unique version index retained")
	}
	if err := db.Create(&DesktopUpdate{ID: "second", Platform: first.Platform, Version: first.Version}).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&DesktopUpdate{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatal("migration did not preserve upload history", count, err)
	}
}
