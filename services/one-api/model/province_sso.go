package model

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/random"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const ProvinceLaunchCodeTTL = 60 * time.Second

// ProvinceIdentity stores the province-platform identity separately from the
// local Parvis user. Account is the stable external identifier.
type ProvinceIdentity struct {
	Id                   int       `json:"id"`
	UserId               int       `json:"user_id" gorm:"uniqueIndex;not null"`
	Account              string    `json:"account" gorm:"type:varchar(128);uniqueIndex;not null"`
	Name                 string    `json:"name" gorm:"type:varchar(255)"`
	UserName             string    `json:"user_name" gorm:"type:varchar(255)"`
	UnitName             string    `json:"unit_name" gorm:"type:varchar(255)"`
	UnitCode             string    `json:"unit_code" gorm:"type:varchar(128)"`
	OrganizationName     string    `json:"organization_name" gorm:"type:varchar(255)"`
	OrganizationCode     string    `json:"organization_code" gorm:"type:varchar(128)"`
	OrganizationLine     string    `json:"organization_line" gorm:"type:text"`
	ResourceOrganization string    `json:"resource_organization_line" gorm:"type:text"`
	RegionName           string    `json:"region_name" gorm:"type:varchar(255)"`
	RegionCode           string    `json:"region_code" gorm:"type:varchar(128)"`
	ExternalRole         string    `json:"external_role" gorm:"type:varchar(255)"`
	EmployeeCode         string    `json:"employee_code" gorm:"type:varchar(128)"`
	ExternalId           string    `json:"external_id" gorm:"type:varchar(128)"`
	IsActive             bool      `json:"is_active" gorm:"index;not null"`
	LastSyncedAt         time.Time `json:"last_synced_at" gorm:"index"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type ProvinceLaunchCode struct {
	Id         int        `json:"id"`
	CodeHash   string     `json:"-" gorm:"type:char(64);uniqueIndex;not null"`
	UserId     int        `json:"user_id" gorm:"index;not null"`
	ExpiresAt  time.Time  `json:"expires_at" gorm:"index;not null"`
	ConsumedAt *time.Time `json:"consumed_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type ProvinceDeviceToken struct {
	Id         int       `json:"id"`
	UserId     int       `json:"user_id" gorm:"uniqueIndex:idx_province_user_device;index;not null"`
	DeviceId   string    `json:"device_id" gorm:"type:char(36);uniqueIndex:idx_province_user_device;not null"`
	TokenId    int       `json:"token_id" gorm:"index;not null"`
	LastUsedAt time.Time `json:"last_used_at"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ProvinceProfile struct {
	Account                  string
	Name                     string
	UserName                 string
	UnitName                 string
	UnitCode                 string
	OrganizationName         string
	OrganizationCode         string
	OrganizationLine         string
	ResourceOrganizationLine string
	RegionName               string
	RegionCode               string
	ExternalRole             string
	EmployeeCode             string
	ExternalId               string
	IsActive                 bool
}

type ProvinceLoginResult struct {
	User  *User
	Token *Token
}

func provinceCodeHash(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func ProvinceCodeHashForTest(code string) string {
	return provinceCodeHash(code)
}

func displayNameForProvince(profile ProvinceProfile) string {
	for _, candidate := range []string{profile.Name, profile.UserName, profile.Account} {
		if value := strings.TrimSpace(candidate); value != "" {
			return value
		}
	}
	return profile.Account
}

// UpsertProvinceUser creates the Parvis account on first login and synchronizes
// the authoritative province-platform profile on every later login.
func UpsertProvinceUser(ctx context.Context, profile ProvinceProfile) (*User, error) {
	profile.Account = strings.TrimSpace(profile.Account)
	if profile.Account == "" {
		return nil, errors.New("省域平台未返回 Account")
	}

	var identity ProvinceIdentity
	err := DB.Where("account = ?", profile.Account).First(&identity).Error
	var user *User
	switch {
	case err == nil:
		user, err = GetUserById(identity.UserId, true)
	case errors.Is(err, gorm.ErrRecordNotFound):
		user, err = GetUserByUsername(profile.Account)
		if err == nil {
			return nil, errors.New("省域 Account 与现有 Parvis 账号冲突，请管理员先完成身份绑定")
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			status := UserStatusDisabled
			if profile.IsActive {
				status = UserStatusEnabled
			}
			user = &User{
				Username:    profile.Account,
				DisplayName: displayNameForProvince(profile),
				Role:        RoleCommonUser,
				Status:      status,
				Group:       "default",
				AccountType: AccountTypePersonal,
			}
			if err = user.Insert(ctx, 0); err != nil {
				return nil, err
			}
		}
	default:
		return nil, err
	}
	if err != nil {
		return nil, err
	}

	status := UserStatusDisabled
	if profile.IsActive {
		status = UserStatusEnabled
	}
	user.Status = status
	if err := user.Update(false); err != nil {
		return nil, err
	}
	if common.RedisEnabled {
		_ = common.RedisDel(fmt.Sprintf("user_enabled:%d", user.Id))
	}

	displayName := displayNameForProvince(profile)
	if ACCOUNT_DB != nil {
		SyncAccountProfileByUserID(user.Id, displayName, "", "province_sso")
	} else if err := DB.Model(&User{}).Where("id = ?", user.Id).Update("display_name", displayName).Error; err != nil {
		return nil, err
	}

	now := time.Now()
	identity = ProvinceIdentity{
		UserId:               user.Id,
		Account:              profile.Account,
		Name:                 profile.Name,
		UserName:             profile.UserName,
		UnitName:             profile.UnitName,
		UnitCode:             profile.UnitCode,
		OrganizationName:     profile.OrganizationName,
		OrganizationCode:     profile.OrganizationCode,
		OrganizationLine:     profile.OrganizationLine,
		ResourceOrganization: profile.ResourceOrganizationLine,
		RegionName:           profile.RegionName,
		RegionCode:           profile.RegionCode,
		ExternalRole:         profile.ExternalRole,
		EmployeeCode:         profile.EmployeeCode,
		ExternalId:           profile.ExternalId,
		IsActive:             profile.IsActive,
		LastSyncedAt:         now,
	}
	if err := DB.Where("account = ?", profile.Account).
		Assign(identity).
		FirstOrCreate(&identity).Error; err != nil {
		return nil, err
	}

	user, err = GetUserById(user.Id, false)
	if err != nil {
		return nil, err
	}
	user.Username = profile.Account
	user.DisplayName = displayName
	user.Status = status
	return user, nil
}

func CreateProvinceLaunchCode(userId int) (string, error) {
	if userId <= 0 {
		return "", errors.New("无效用户")
	}
	code := random.GenerateKey()
	record := ProvinceLaunchCode{
		CodeHash:  provinceCodeHash(code),
		UserId:    userId,
		ExpiresAt: time.Now().Add(ProvinceLaunchCodeTTL),
	}
	if err := DB.Create(&record).Error; err != nil {
		return "", err
	}
	// Opportunistic cleanup; a failure here must not block login.
	_ = DB.Where("expires_at < ? OR consumed_at IS NOT NULL", time.Now().Add(-24*time.Hour)).
		Delete(&ProvinceLaunchCode{}).Error
	return code, nil
}

func usableProvinceToken(token *Token, now int64) bool {
	if token == nil || token.Status != TokenStatusEnabled {
		return false
	}
	if token.ExpiredTime != -1 && token.ExpiredTime < now {
		return false
	}
	return token.UnlimitedQuota || token.RemainQuota > 0
}

func validProvinceDeviceID(deviceId string) bool {
	parsed, err := uuid.Parse(deviceId)
	return err == nil && parsed.String() == strings.ToLower(deviceId)
}

func ConsumeProvinceLaunchCode(code string, deviceId string) (*ProvinceLoginResult, error) {
	code = strings.TrimSpace(code)
	deviceId = strings.TrimSpace(deviceId)
	if code == "" || len(code) > 256 {
		return nil, errors.New("无效启动码")
	}
	if !validProvinceDeviceID(deviceId) {
		return nil, errors.New("无效设备标识")
	}

	var result ProvinceLoginResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		var launch ProvinceLaunchCode
		query := tx.Where("code_hash = ?", provinceCodeHash(code))
		if !common.UsingSQLite {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&launch).Error; err != nil {
			return errors.New("启动码无效或已过期")
		}
		now := time.Now()
		if launch.ConsumedAt != nil || !launch.ExpiresAt.After(now) {
			return errors.New("启动码无效或已过期")
		}
		if err := tx.Model(&launch).Update("consumed_at", now).Error; err != nil {
			return err
		}

		var identity ProvinceIdentity
		if err := tx.Where("user_id = ?", launch.UserId).First(&identity).Error; err != nil {
			return errors.New("省域账号不存在")
		}
		if !identity.IsActive {
			return errors.New("省域账号已停用")
		}
		var user User
		if err := tx.Where("id = ?", launch.UserId).First(&user).Error; err != nil {
			return err
		}
		if user.Status != UserStatusEnabled {
			return errors.New("Parvis 账号已停用")
		}

		var mapping ProvinceDeviceToken
		mappingErr := tx.Where("user_id = ? AND device_id = ?", user.Id, deviceId).First(&mapping).Error
		var token Token
		if mappingErr == nil {
			tokenErr := tx.Where("id = ? AND user_id = ?", mapping.TokenId, user.Id).First(&token).Error
			if tokenErr != nil && !errors.Is(tokenErr, gorm.ErrRecordNotFound) {
				return tokenErr
			}
		} else if !errors.Is(mappingErr, gorm.ErrRecordNotFound) {
			return mappingErr
		}
		timestamp := helper.GetTimestamp()
		if !usableProvinceToken(&token, timestamp) {
			token = Token{
				UserId:         user.Id,
				Name:           fmt.Sprintf("province-%s", provinceCodeHash(deviceId)[:12]),
				Key:            random.GenerateKey(),
				Status:         TokenStatusEnabled,
				CreatedTime:    timestamp,
				AccessedTime:   timestamp,
				ExpiredTime:    -1,
				RemainQuota:    -1,
				UnlimitedQuota: true,
			}
			if err := tx.Create(&token).Error; err != nil {
				return err
			}
			mapping = ProvinceDeviceToken{
				UserId:     user.Id,
				DeviceId:   deviceId,
				TokenId:    token.Id,
				LastUsedAt: now,
			}
			if err := tx.Where("user_id = ? AND device_id = ?", user.Id, deviceId).
				Assign(mapping).
				FirstOrCreate(&mapping).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Model(&mapping).Update("last_used_at", now).Error; err != nil {
				return err
			}
			_ = tx.Model(&token).Update("accessed_time", timestamp).Error
		}

		user.Username = identity.Account
		user.DisplayName = displayNameForProvince(ProvinceProfile{
			Account:  identity.Account,
			Name:     identity.Name,
			UserName: identity.UserName,
		})
		result.User = &user
		result.Token = &token
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func RevokeProvinceDeviceToken(userId int, tokenId int, deviceId string) error {
	deviceId = strings.TrimSpace(deviceId)
	if userId <= 0 || tokenId <= 0 || !validProvinceDeviceID(deviceId) {
		return errors.New("无效设备标识")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var mapping ProvinceDeviceToken
		if err := tx.Where("user_id = ? AND token_id = ? AND device_id = ?", userId, tokenId, deviceId).
			First(&mapping).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("设备登录记录不存在")
			}
			return err
		}
		var token Token
		if err := tx.Where("id = ? AND user_id = ?", tokenId, userId).First(&token).Error; err != nil {
			return err
		}
		if err := tx.Model(&token).Updates(map[string]interface{}{
			"status":        TokenStatusDisabled,
			"accessed_time": helper.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&mapping).Error; err != nil {
			return err
		}
		if common.RedisEnabled {
			_ = common.RedisDel(fmt.Sprintf("token:%s", token.Key))
		}
		return nil
	})
}
