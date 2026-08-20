package model

import (
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupChannelCryptoTestDB(t *testing.T) {
	t.Helper()
	previousDB := DB
	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	DB = db
	if err := DB.AutoMigrate(&Channel{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { DB = previousDB })
}

func TestChannelKeyEncryptedAtRestAndDecryptedOnRead(t *testing.T) {
	setupChannelCryptoTestDB(t)
	t.Setenv("PARVIS_CHANNEL_KEY_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")

	channel := Channel{Name: "internal-model", Key: "plain-secret"}
	if err := DB.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}

	var stored struct {
		Key string
	}
	if err := DB.Session(&gorm.Session{SkipHooks: true}).Model(&Channel{}).
		Select("key").Where("id = ?", channel.Id).Scan(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Key == "plain-secret" || !strings.HasPrefix(stored.Key, encryptedChannelKeyPrefix) {
		t.Fatalf("channel key is not encrypted at rest: %q", stored.Key)
	}

	var loaded Channel
	if err := DB.First(&loaded, channel.Id).Error; err != nil {
		t.Fatal(err)
	}
	if loaded.Key != "plain-secret" {
		t.Fatalf("unexpected decrypted key: %q", loaded.Key)
	}
}

func TestMigratePlaintextChannelKeysIsIdempotent(t *testing.T) {
	setupChannelCryptoTestDB(t)
	t.Setenv("PARVIS_CHANNEL_KEY_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")

	channel := Channel{Name: "legacy", Key: "legacy-secret"}
	if err := DB.Session(&gorm.Session{SkipHooks: true}).Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigratePlaintextChannelKeys(); err != nil {
		t.Fatal(err)
	}
	if err := MigratePlaintextChannelKeys(); err != nil {
		t.Fatal(err)
	}

	var loaded Channel
	if err := DB.First(&loaded, channel.Id).Error; err != nil {
		t.Fatal(err)
	}
	if loaded.Key != "legacy-secret" {
		t.Fatalf("unexpected migrated key: %q", loaded.Key)
	}
}

func TestDecryptChannelKeyRejectsWrongKey(t *testing.T) {
	t.Setenv("PARVIS_CHANNEL_KEY_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
	encrypted, err := EncryptChannelKey("plain-secret")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("PARVIS_CHANNEL_KEY_ENCRYPTION_KEY", "abcdef0123456789abcdef0123456789")
	if _, err := DecryptChannelKey(encrypted); err == nil {
		t.Fatal("expected decryption to fail with a different key")
	}
}
