package model

import (
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"testing"
)

func TestUnifiedBillingLockedDefaultSkillPrice(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { conn.Close() })
	old := config.QuotaPerUnit
	config.QuotaPerUnit = 1000
	t.Cleanup(func() { config.QuotaPerUnit = old })
	require.NoError(t, db.AutoMigrate(&BillingRule{}, &Skill{}, &ExpertWebProfile{}))
	require.NoError(t, db.Create(&Skill{Name: "pvs-contract-template", Status: 1, TaskCredits: 3}).Error)
	require.NoError(t, db.Create(&ExpertWebProfile{Key: "report", Published: true, TaskCredits: 5}).Error)
	// Reproduce the old initialized-statement failure, independently of dialect SQL.
	stale := db.Clauses(clause.Locking{Strength: "UPDATE"})
	var missing BillingRule
	require.ErrorIs(t, stale.Where("kind = ?", "skill").First(&missing).Error, gorm.ErrRecordNotFound)
	var existing Skill
	require.ErrorIs(t, stale.Where("name = ?", "pvs-contract-template").First(&existing).Error, gorm.ErrRecordNotFound)
	for _, item := range []struct {
		kind, id string
		quota    int64
	}{
		{"skill", "pvs-contract-template", 3000}, {"expert", "report", 5000},
	} {
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
			locked := tx.Clauses(clause.Locking{Strength: "UPDATE"})
			rule, err := ResolveBusinessRule(locked, item.kind, item.id, "default")
			require.NoError(t, err)
			require.Equal(t, item.quota, rule.UnitQuota)
			require.Equal(t, item.quota+1, rule.Version)
			return nil
		}))
	}
}
