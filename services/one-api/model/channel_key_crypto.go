package model

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
)

const encryptedChannelKeyPrefix = "enc:v1:"

func decodeChannelEncryptionKey(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if decoded, err := hex.DecodeString(raw); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if len([]byte(raw)) == 32 {
		return []byte(raw), nil
	}
	return nil, errors.New("PARVIS_CHANNEL_KEY_ENCRYPTION_KEY 必须是 32 字节原文、64 位十六进制或 32 字节 Base64")
}

func channelEncryptionKey() ([]byte, error) {
	return decodeChannelEncryptionKey(os.Getenv("PARVIS_CHANNEL_KEY_ENCRYPTION_KEY"))
}

func ValidateChannelKeyEncryptionConfig() error {
	key, err := channelEncryptionKey()
	if err != nil {
		return err
	}
	if config.DeploymentMode() == "private" && len(key) != 32 {
		return errors.New("私有化模式必须配置 PARVIS_CHANNEL_KEY_ENCRYPTION_KEY")
	}
	return nil
}

func EncryptChannelKey(plainText string) (string, error) {
	if plainText == "" || strings.HasPrefix(plainText, encryptedChannelKeyPrefix) {
		return plainText, nil
	}
	key, err := channelEncryptionKey()
	if err != nil {
		return "", err
	}
	// Tests and non-private utilities may not execute the production startup
	// validation. The private server itself always validates before opening DB.
	if len(key) == 0 {
		return plainText, nil
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plainText), nil)
	payload := append(nonce, sealed...)
	return encryptedChannelKeyPrefix + base64.RawStdEncoding.EncodeToString(payload), nil
}

func DecryptChannelKey(cipherText string) (string, error) {
	if cipherText == "" || !strings.HasPrefix(cipherText, encryptedChannelKeyPrefix) {
		return cipherText, nil
	}
	key, err := channelEncryptionKey()
	if err != nil {
		return "", err
	}
	if len(key) != 32 {
		return "", errors.New("无法解密渠道密钥：未配置 PARVIS_CHANNEL_KEY_ENCRYPTION_KEY")
	}
	payload, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(cipherText, encryptedChannelKeyPrefix))
	if err != nil {
		return "", errors.New("渠道密钥密文格式错误")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) < gcm.NonceSize() {
		return "", errors.New("渠道密钥密文长度错误")
	}
	plainText, err := gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("渠道密钥解密失败")
	}
	return string(plainText), nil
}

func (channel *Channel) BeforeSave(_ *gorm.DB) error {
	encrypted, err := EncryptChannelKey(channel.Key)
	if err != nil {
		return err
	}
	channel.Key = encrypted
	return nil
}

func (channel *Channel) AfterFind(_ *gorm.DB) error {
	decrypted, err := DecryptChannelKey(channel.Key)
	if err != nil {
		return fmt.Errorf("渠道 %d 密钥解密失败: %w", channel.Id, err)
	}
	channel.Key = decrypted
	return nil
}

// MigratePlaintextChannelKeys encrypts legacy rows in place. It is idempotent
// and bypasses hooks while inspecting the stored value.
func MigratePlaintextChannelKeys() error {
	if err := ValidateChannelKeyEncryptionConfig(); err != nil {
		return err
	}
	type storedChannelKey struct {
		Id  int
		Key string
	}
	var rows []storedChannelKey
	if err := DB.Session(&gorm.Session{SkipHooks: true}).Model(&Channel{}).Select("id", "key").Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if row.Key == "" {
			continue
		}
		if strings.HasPrefix(row.Key, encryptedChannelKeyPrefix) {
			if _, err := DecryptChannelKey(row.Key); err != nil {
				return fmt.Errorf("渠道 %d 的历史密钥无法解密: %w", row.Id, err)
			}
			continue
		}
		encrypted, err := EncryptChannelKey(row.Key)
		if err != nil {
			return fmt.Errorf("加密渠道 %d 的历史密钥失败: %w", row.Id, err)
		}
		if err := DB.Session(&gorm.Session{SkipHooks: true}).Model(&Channel{}).
			Where("id = ?", row.Id).
			UpdateColumn("key", encrypted).Error; err != nil {
			return err
		}
	}
	return nil
}
