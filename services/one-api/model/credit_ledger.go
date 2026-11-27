package model

import (
	"context"
	"reflect"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CreditLedger is append-only. Amounts use the same integer unit as users.quota.
// A ledger write fails the owning transaction rather than leaving an unaudited balance.
type CreditLedger struct {
	ID             int64          `json:"id" gorm:"primaryKey"`
	OccurredAt     int64          `json:"occurred_at" gorm:"index"`
	OrgID          int            `json:"org_id" gorm:"index"`
	UserID         int            `json:"user_id" gorm:"index"`
	Username       string         `json:"username"`
	DisplayName    string         `json:"display_name"`
	DepartmentName string         `json:"department_name"`
	UnitName       string         `json:"unit_name"`
	ActorID        int            `json:"actor_id" gorm:"index"`
	ActorName      string         `json:"actor_name"`
	Source         string         `json:"source" gorm:"size:64;index"`
	Reference      string         `json:"reference" gorm:"size:128;index"`
	Description    string         `json:"description"`
	Delta          int64          `json:"delta"`
	BalanceBefore  *int64         `json:"balance_before"`
	BalanceAfter   *int64         `json:"balance_after"`
	Historical     bool           `json:"historical"`
	Origin         string         `json:"-" gorm:"size:160;uniqueIndex"`
	TaskState      string         `json:"task_state,omitempty" gorm:"-"`
	Entries        []CreditLedger `json:"entries,omitempty" gorm:"-"`
}

type CreditAuditInfo struct {
	ActorID                                   int
	ActorName, Source, Reference, Description string
}
type creditAuditKey struct{}

func WithCreditAudit(db *gorm.DB, info CreditAuditInfo) *gorm.DB {
	return db.WithContext(context.WithValue(db.Statement.Context, creditAuditKey{}, info))
}

func defaultCreditAudit(db *gorm.DB, source, reference, description string) *gorm.DB {
	info := creditAuditInfo(db.Statement.Context)
	if info.Source != "account_adjustment" {
		return db
	}
	info.Source, info.Reference, info.Description = source, reference, description
	return WithCreditAudit(db, info)
}

func creditAuditInfo(ctx context.Context) CreditAuditInfo {
	info, _ := ctx.Value(creditAuditKey{}).(CreditAuditInfo)
	if info.ActorName == "" {
		info.ActorName = "系统"
	}
	if info.Source == "" {
		info.Source = "account_adjustment"
	}
	return info
}

// RegisterCreditLedger captures every GORM user-balance mutation, including bulk
// grants, expiry, subscription replacement and account-type changes. It only
// observes quota; token mirrors and used_quota never create duplicate entries.
func RegisterCreditLedger(db *gorm.DB) error {
	if db.Migrator().HasTable(&CreditLedgerMigration{}) {
		now := time.Now()
		if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&CreditLedgerMigration{ID: "history-v1", Cutoff: now.Unix(), CutoffNanos: now.UnixNano()}).Error; err != nil {
			return err
		}
	}
	if err := db.Callback().Create().After("gorm:create").Before("gorm:after_create").Register("credit_ledger:opening", recordCreditOpening); err != nil {
		return err
	}
	if err := db.Callback().Update().Before("gorm:update").Register("credit_ledger:before", func(tx *gorm.DB) {
		stmt := tx.Statement
		if tx.Error != nil || stmt.Schema == nil || (stmt.Schema.Table != "users" && stmt.Schema.Table != "organizations") {
			return
		}
		if fields, ok := stmt.Dest.(map[string]interface{}); ok {
			_, changes := fields["quota"]
			_, capitalized := fields["Quota"]
			changes = changes || capitalized
			if stmt.Schema.Table == "organizations" {
				_, used := fields["used_quota"]
				_, capitalUsed := fields["UsedQuota"]
				used = used || capitalUsed
				changes = changes || used
			}
			if !changes {
				return
			}
		}
		columns, restricted := stmt.SelectAndOmitColumns(false, true)
		allowed := func(name string) bool {
			value, exists := columns[name]
			return (exists && value) || (!exists && !restricted)
		}
		if !allowed("quota") && (stmt.Table != "organizations" || !allowed("used_quota")) {
			return
		}
		query := tx.Session(&gorm.Session{NewDB: true}).Table(stmt.Table)
		where, hasWhere := stmt.Clauses["WHERE"]
		if hasWhere {
			query = query.Clauses(where.Expression)
		}
		value := reflect.Indirect(reflect.ValueOf(stmt.Model))
		if value.IsValid() && value.Kind() == reflect.Struct {
			if id, zero := stmt.Schema.PrioritizedPrimaryField.ValueOf(stmt.Context, value); !zero {
				query = query.Where("id = ?", id)
				hasWhere = true
			}
		}
		if value.IsValid() && (value.Kind() == reflect.Slice || value.Kind() == reflect.Array) {
			ids := []interface{}{}
			for i := 0; i < value.Len(); i++ {
				v := reflect.Indirect(value.Index(i))
				if v.Kind() == reflect.Struct {
					if id, zero := stmt.Schema.PrioritizedPrimaryField.ValueOf(stmt.Context, v); !zero {
						ids = append(ids, id)
					}
				}
			}
			if len(ids) > 0 {
				query = query.Where("id IN ?", ids)
				hasWhere = true
			}
		}
		// Do not turn an invalid global update into a table-wide read or audit.
		if !hasWhere && !tx.AllowGlobalUpdate {
			return
		}
		if tx.Dialector.Name() != "sqlite" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var users []creditAccountSnapshot
		fields := "id, username, display_name, department_name, unit_name, quota"
		if stmt.Schema.Table == "organizations" {
			fields = "id, name AS username, name AS unit_name, quota, used_quota"
		}
		if err := query.Select(fields).Order("id").Scan(&users).Error; err != nil {
			tx.AddError(err)
			return
		}
		stmt.Settings.Store("credit_ledger:users", users)
	}); err != nil {
		return err
	}
	return db.Callback().Update().After("gorm:update").Before("gorm:commit_or_rollback_transaction").Register("credit_ledger:after", func(tx *gorm.DB) {
		if tx.Error != nil || tx.RowsAffected == 0 {
			return
		}
		stored, ok := tx.Statement.Settings.LoadAndDelete("credit_ledger:users")
		if !ok {
			return
		}
		info := creditAuditInfo(tx.Statement.Context)
		for _, user := range stored.([]creditAccountSnapshot) {
			var current creditAccountSnapshot
			clean := tx.Session(&gorm.Session{NewDB: true})
			if err := clean.Table(tx.Statement.Table).Select("quota"+func() string {
				if tx.Statement.Table == "organizations" {
					return ", used_quota"
				}
				return ""
			}()).Where("id = ?", user.ID).Take(&current).Error; err != nil {
				tx.AddError(err)
				return
			}
			orgID := 0
			if tx.Statement.Table == "organizations" {
				orgID = user.ID
				user.ID = 0
				user.Quota -= user.UsedQuota
				current.Quota -= current.UsedQuota
				if user.Quota < 0 {
					user.Quota = 0
				}
				if current.Quota < 0 {
					current.Quota = 0
				}
			}
			if info.ActorID > 0 && info.ActorID == user.ID && (info.ActorName == "系统" || info.ActorName == "") {
				info.ActorName = user.Username
			}
			if user.Quota == current.Quota {
				continue
			}
			actorName := info.ActorName
			if info.ActorID > 0 && (actorName == "系统" || actorName == "") {
				actorName = creditActorName(tx, info.ActorID)
			}
			row := CreditLedger{OrgID: orgID, OccurredAt: time.Now().Unix(), UserID: user.ID, Username: user.Username,
				DisplayName: user.DisplayName, DepartmentName: user.DepartmentName, UnitName: user.UnitName,
				ActorID: info.ActorID, ActorName: actorName, Source: info.Source, Reference: info.Reference,
				Description: info.Description, Delta: current.Quota - user.Quota, BalanceBefore: &user.Quota, BalanceAfter: &current.Quota}
			// A nullable unique origin is reserved for idempotent historical imports.
			if err := clean.Omit("origin").Create(&row).Error; err != nil {
				tx.AddError(err)
				return
			}
		}
	})
}

func creditActorName(tx *gorm.DB, id int) string {
	var actor User
	if id > 0 {
		tx.Session(&gorm.Session{NewDB: true}).Select("username").Where("id = ?", id).Find(&actor)
	}
	return actor.Username
}

type creditAccountSnapshot struct {
	ID                                              int
	Username, DisplayName, DepartmentName, UnitName string
	Quota, UsedQuota                                int64
}

func recordCreditOpening(tx *gorm.DB) {
	stmt := tx.Statement
	if tx.Error != nil || stmt.Schema == nil || (stmt.Table != "users" && stmt.Table != "organizations") {
		return
	}
	visit := func(value reflect.Value) {
		value = reflect.Indirect(value)
		if value.Kind() != reflect.Struct {
			return
		}
		id, _ := stmt.Schema.PrioritizedPrimaryField.ValueOf(stmt.Context, value)
		raw, _ := stmt.Schema.LookUpField("Quota").ValueOf(stmt.Context, value)
		amount, _ := raw.(int64)
		if stmt.Table == "organizations" {
			used, _ := stmt.Schema.LookUpField("UsedQuota").ValueOf(stmt.Context, value)
			n, _ := used.(int64)
			amount -= n
		}
		if amount == 0 {
			return
		}
		info := creditAuditInfo(stmt.Context)
		before := int64(0)
		row := CreditLedger{OccurredAt: time.Now().Unix(), ActorID: info.ActorID, ActorName: info.ActorName, Source: "account_opening", Description: "账户初始积分", Delta: amount, BalanceBefore: &before, BalanceAfter: &amount}
		field := func(name string) string {
			v, _ := stmt.Schema.LookUpField(name).ValueOf(stmt.Context, value)
			s, _ := v.(string)
			return s
		}
		if stmt.Table == "users" {
			row.UserID, _ = id.(int)
			row.Username = field("Username")
			row.DisplayName = field("DisplayName")
			row.UnitName = field("UnitName")
			row.DepartmentName = field("DepartmentName")
		} else {
			row.OrgID, _ = id.(int)
			row.Username = field("Name")
			row.UnitName = row.Username
		}
		if err := tx.Session(&gorm.Session{NewDB: true}).Omit("origin").Create(&row).Error; err != nil {
			tx.AddError(err)
		}
	}
	values := stmt.ReflectValue
	if values.Kind() == reflect.Slice || values.Kind() == reflect.Array {
		for i := 0; i < values.Len(); i++ {
			visit(values.Index(i))
		}
	} else {
		visit(values)
	}
}
