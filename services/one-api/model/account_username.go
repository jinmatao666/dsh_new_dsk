package model

import (
	"errors"
	"github.com/songquanpeng/one-api/common/snowflake"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
)

// initializePhoneUsername preserves an existing username and initializes an absent one from a verified phone.
func initializePhoneUsername(tx *gorm.DB, accountID int64, phone string) (string, error) {
	var name AccountIdentifier
	err := tx.Where("account_id = ? AND type = ?", accountID, IdentifierTypeUsername).First(&name).Error
	if err == nil && strings.TrimSpace(name.Identifier) != "" {
		return name.Identifier, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	if err == nil {
		if err := tx.Delete(&name).Error; err != nil {
			return "", err
		}
	}
	phone = strings.TrimPrefix(phone, "+86")
	name = AccountIdentifier{Id: snowflake.NextID(), AccountId: accountID, Type: IdentifierTypeUsername, Identifier: phone, Verified: true}
	if err := tx.Create(&name).Error; err != nil {
		return "", err
	}
	return phone, nil
}

// InitializePhoneUsername fills only an absent username from the account's verified phone.
// Internal users-table placeholders are never treated as account-center usernames.
func InitializePhoneUsername(userID int) (string, error) {
	if ACCOUNT_DB == nil {
		var user User
		if err := DB.First(&user, userID).Error; err != nil {
			return "", err
		}
		if user.Username != "" || !user.PhoneVerified || user.Phone == "" {
			return user.Username, nil
		}
		name := strings.TrimPrefix(user.Phone, "+86")
		err := DB.Model(&User{}).Where("id = ? AND username = ?", userID, "").Update("username", name).Error
		return name, err
	}
	var product AccountProduct
	if err := ACCOUNT_DB.Where("product_code = ? AND local_user_id = ?", ProductCodeParvis, userID).First(&product).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			var legacy User
			if err := DB.First(&legacy, userID).Error; err != nil {
				return "", err
			}
			return legacy.Username, nil
		}
		return "", err
	}
	var name string
	err := ACCOUNT_DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&Account{}, product.AccountId).Error; err != nil {
			return err
		}
		var ident AccountIdentifier
		err := tx.Where("account_id = ? AND type = ?", product.AccountId, IdentifierTypeUsername).First(&ident).Error
		if err == nil && strings.TrimSpace(ident.Identifier) != "" {
			name = ident.Identifier
			return nil
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		ident = AccountIdentifier{}
		err = tx.Where("account_id = ? AND type = ? AND verified = ?", product.AccountId, IdentifierTypePhone, true).Where("identifier <> ?", "").First(&ident).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		name, err = initializePhoneUsername(tx, product.AccountId, ident.Identifier)
		return err
	})
	return name, err
}
