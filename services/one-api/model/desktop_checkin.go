package model

import (
	"encoding/json"
	"errors"
	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"time"
)

// DesktopCheckinState serializes claims across devices and application instances.
type DesktopCheckinState struct {
	UserId  int    `gorm:"primaryKey"`
	LastDay string `gorm:"size:10"`
}

// DesktopCheckinReceipt is written in the same transaction as the quota ledger.
type DesktopCheckinReceipt struct {
	Id           int64 `gorm:"primaryKey"`
	UserId       int   `gorm:"index"`
	Day          string
	Amount       int64
	BalanceAfter int64
	CreatedAt    time.Time
}
type DesktopCheckinStatus struct {
	Enabled      bool   `json:"enabled"`
	CanClaim     bool   `json:"can_claim"`
	Amount       int    `json:"amount"`
	IntervalDays int    `json:"interval_days"`
	NextDate     string `json:"next_date"`
}

var checkinLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

func desktopCheckinRule() DesktopCheckinStatus {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	var settings struct {
		Edition       string `json:"edition"`
		CreditRewards struct {
			Login struct {
				Enabled      bool `json:"enabled"`
				Amount       int  `json:"amount"`
				IntervalDays int  `json:"intervalDays"`
			} `json:"login"`
		} `json:"creditRewards"`
	}
	if json.Unmarshal([]byte(raw), &settings) != nil {
		return DesktopCheckinStatus{}
	}
	r := settings.CreditRewards.Login
	valid := settings.Edition == "operations" && r.Enabled && r.Amount >= 1 && r.Amount <= 1000000 && r.IntervalDays >= 1 && r.IntervalDays <= 3650
	return DesktopCheckinStatus{Enabled: valid, Amount: r.Amount, IntervalDays: r.IntervalDays}
}
func checkinAvailability(s DesktopCheckinStatus, last string, now time.Time) DesktopCheckinStatus {
	if !s.Enabled {
		return s
	}
	s.CanClaim = true
	if last != "" {
		day, err := time.ParseInLocation("2006-01-02", last, checkinLocation)
		if err != nil {
			s.CanClaim = false
			return s
		}
		next := day.AddDate(0, 0, s.IntervalDays)
		s.NextDate = next.Format("2006-01-02")
		s.CanClaim = now.In(checkinLocation).Format("2006-01-02") >= s.NextDate
	}
	return s
}
func GetDesktopCheckinStatus(userId int) (DesktopCheckinStatus, error) {
	s := desktopCheckinRule()
	if !s.Enabled {
		return s, nil
	}
	var state DesktopCheckinState
	err := DB.Where("user_id = ?", userId).First(&state).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return s, err
	}
	return checkinAvailability(s, state.LastDay, time.Now()), nil
}
func ClaimDesktopCheckin(userId int) error {
	s := desktopCheckinRule()
	if !s.Enabled {
		return errors.New("签到赠送未开启")
	}
	unit := config.QuotaPerUnit
	if unit <= 0 || math.IsNaN(unit) || math.IsInf(unit, 0) || float64(s.Amount)*unit > float64(math.MaxInt64) {
		return errors.New("积分换算配置无效")
	}
	amount := int64(math.Round(float64(s.Amount) * unit))
	if amount <= 0 {
		return errors.New("积分换算配置无效")
	}
	now := time.Now()
	today := now.In(checkinLocation).Format("2006-01-02")
	cutoff := now.In(checkinLocation).AddDate(0, 0, -s.IntervalDays).Format("2006-01-02")
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&DesktopCheckinState{UserId: userId}).Error; err != nil {
			return err
		}
		result := tx.Model(&DesktopCheckinState{}).Where("user_id = ? AND (last_day = '' OR last_day <= ?)", userId, cutoff).Update("last_day", today)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("本周期已签到，请勿重复领取")
		}
		if err := AddUserTimedQuotaTx(tx, userId, amount, "checkin", today, nil); err != nil {
			return err
		}
		var user User
		if err := tx.Select("quota").First(&user, userId).Error; err != nil {
			return err
		}
		return tx.Create(&DesktopCheckinReceipt{UserId: userId, Day: today, Amount: amount, BalanceAfter: user.Quota, CreatedAt: now}).Error
	})
	if err == nil {
		InvalidateUserAccountCache(userId)
	}
	return err
}
