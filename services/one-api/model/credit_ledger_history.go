package model

import (
	"fmt"
	"time"

	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Historical receipts cannot reconstruct balances or operators that were never
// stored. Import only known facts; never invent a running historical balance.
type CreditLedgerMigration struct {
	ID          string `gorm:"primaryKey;size:32"`
	Cutoff      int64
	CutoffNanos int64
	Complete    bool
	Failed      bool
}

func ImportCreditLedgerHistory() error {
	now := time.Now()
	state := CreditLedgerMigration{ID: "history-v1", Cutoff: now.Unix(), CutoffNanos: now.UnixNano()}
	if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
		return err
	}
	if err := DB.First(&state, "id = ?", state.ID).Error; err != nil {
		return err
	}
	if state.Complete {
		return nil
	}
	if err := DB.Model(&state).Update("failed", false).Error; err != nil {
		return err
	}
	cutoff := time.Unix(state.Cutoff, 0)
	if state.CutoffNanos > 0 {
		cutoff = time.Unix(0, state.CutoffNanos)
	}
	write := func(row CreditLedger) error {
		if row.Delta == 0 {
			return nil
		}
		var user User
		if err := DB.Select("username", "display_name", "unit_name", "department_name").Where("id = ?", row.UserID).Find(&user).Error; err != nil {
			return err
		}
		row.Username, row.DisplayName, row.UnitName, row.DepartmentName = user.Username, user.DisplayName, user.UnitName, user.DepartmentName
		if row.OrgID > 0 {
			var org Organization
			if err := DB.Select("name").Where("id = ?", row.OrgID).Find(&org).Error; err != nil {
				return err
			}
			row.Username, row.UnitName = org.Name, org.Name
		}
		row.Historical = true
		if row.ActorID > 0 {
			var actor User
			if err := DB.Select("username").Where("id = ?", row.ActorID).Find(&actor).Error; err != nil {
				return err
			}
			row.ActorName = actor.Username
		}
		return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
	}
	var grants []AdminCreditGrant
	if err := DB.Where("created_at < ?", cutoff).FindInBatches(&grants, 200, func(tx *gorm.DB, batch int) error {
		for _, r := range grants {
			source := TimedQuotaSourceAdmin
			var timed UserTimedQuota
			if err := DB.Select("source").Where("user_id = ? AND source_ref = ?", r.UserId, r.Reference).Limit(1).Find(&timed).Error; err != nil {
				return err
			}
			if timed.Source != "" {
				source = timed.Source
			}
			after := r.BalanceAfter
			before := after - r.Amount
			if err := write(CreditLedger{UserID: r.UserId, ActorID: r.ActorId, OccurredAt: r.CreatedAt.Unix(), Delta: r.Amount, BalanceBefore: &before, BalanceAfter: &after, Source: source, Reference: r.Reference, Description: r.Remark, Origin: "grant:" + r.Reference}); err != nil {
				return err
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	var checkins []DesktopCheckinReceipt
	if err := DB.Where("created_at < ?", cutoff).FindInBatches(&checkins, 200, func(tx *gorm.DB, batch int) error {
		for _, r := range checkins {
			after := r.BalanceAfter
			before := after - r.Amount
			if err := write(CreditLedger{UserID: r.UserId, ActorID: r.UserId, OccurredAt: r.CreatedAt.Unix(), Delta: r.Amount, BalanceBefore: &before, BalanceAfter: &after, Source: "checkin", Reference: r.Day, Origin: fmt.Sprintf("checkin:%d", r.Id)}); err != nil {
				return err
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	var timed []UserTimedQuota
	if err := DB.Where("created_at < ? AND source IN ? AND source_ref NOT LIKE ?", cutoff, []string{"register", "redeem", "topup", "invite", "admin", "purchase", "refund", "activity", "knowledge"}, "migration%").FindInBatches(&timed, 200, func(tx *gorm.DB, batch int) error {
		for _, r := range timed {
			if r.Source == "redeem" {
				r.SourceRef = "兑换到账"
			}
			var count int64
			if err := DB.Model(&AdminCreditGrant{}).Where("user_id = ? AND reference = ?", r.UserId, r.SourceRef).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			if err := write(CreditLedger{UserID: r.UserId, OccurredAt: r.CreatedAt.Unix(), Delta: r.Amount, Source: r.Source, Reference: r.SourceRef, Description: "历史发放批次（可能包含合并记录）", Origin: fmt.Sprintf("timed:%d", r.Id)}); err != nil {
				return err
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	var tasks []BillingTask
	if err := DB.Where("created_at < ? AND quota > 0 AND (state IN ? OR settled_at >= ?)", cutoff, []string{"succeeded", "reserved"}, cutoff).FindInBatches(&tasks, 200, func(tx *gorm.DB, batch int) error {
		for _, r := range tasks {
			source := r.Kind + "_consume"
			when := r.SettledAt
			var after *int64 = &r.BalanceAfter
			if r.State != "succeeded" {
				source = r.Kind + "_reserve"
				when = &r.CreatedAt
				if r.State != "reserved" {
					after = nil
				}
			}
			if when == nil {
				when = &r.CreatedAt
			}
			if err := write(CreditLedger{UserID: r.UserID, ActorID: r.UserID, OccurredAt: when.Unix(), Delta: -r.Quota, BalanceAfter: after, Source: source, Reference: r.ID, Description: r.ResourceName + " · " + r.PointName, Origin: "task:" + r.ID}); err != nil {
				return err
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	var receipts []KnowledgeCreditReceipt
	if err := DB.Where("created_at < ?", cutoff).FindInBatches(&receipts, 200, func(tx *gorm.DB, batch int) error {
		for _, r := range receipts {
			if r.BillingTaskId == "" {
				after := r.BalanceAfter
				if err := write(CreditLedger{UserID: r.UserId, ActorID: r.UserId, OccurredAt: r.CreatedAt.Unix(), Delta: -int64(float64(r.Cents) * config.QuotaPerUnit / 100), BalanceAfter: &after, Source: "knowledge_debit", Reference: r.RequestId, Description: r.LibraryName + " · " + r.Action, Origin: fmt.Sprintf("knowledge:%d", r.Id)}); err != nil {
					return err
				}
			}
			// Maintainer income already has an immutable common grant receipt.
		}
		return nil
	}).Error; err != nil {
		return err
	}
	var orgGrants []OrgTimedQuota
	if err := DB.Where("created_at < ? AND source IN ? AND source_ref NOT LIKE ?", cutoff, []string{"admin", "topup", "refund"}, "migration%").FindInBatches(&orgGrants, 200, func(tx *gorm.DB, batch int) error {
		for _, r := range orgGrants {
			if err := write(CreditLedger{OrgID: r.OrgId, OccurredAt: r.CreatedAt.Unix(), Delta: r.Amount, Source: r.Source, Reference: r.SourceRef, Description: "历史企业发放批次", Origin: fmt.Sprintf("org-timed:%d", r.Id)}); err != nil {
				return err
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	var logs []Log
	if err := LOG_DB.Where("created_at <= ? AND type = ? AND quota <> 0", state.Cutoff, LogTypeConsume).FindInBatches(&logs, 200, func(tx *gorm.DB, batch int) error {
		for _, r := range logs {
			if r.RequestId != "" {
				var count int64
				if err := DB.Model(&CreditLedger{}).Where("reference = ? AND historical = ?", r.RequestId, false).Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					continue
				}
			}
			uid := r.UserId
			if r.OrgId > 0 {
				uid = 0
			}
			if err := write(CreditLedger{OrgID: r.OrgId, UserID: uid, ActorID: r.UserId, OccurredAt: r.CreatedAt, Delta: -int64(r.Quota), Source: "historical_model", Reference: r.RequestId, Description: r.ModelName, Origin: fmt.Sprintf("log:%d", r.Id)}); err != nil {
				return err
			}
		}
		return nil
	}).Error; err != nil {
		return err
	}
	return DB.Model(&state).Update("complete", true).Error
}
