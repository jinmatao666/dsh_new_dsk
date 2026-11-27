package controller

import (
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func settlementKind(source string) string {
	switch source {
	case "model_reserve", "model_debit", "model_refund":
		return "model"
	case "skill_reserve", "skill_refund", "expert_reserve", "expert_refund",
		"knowledge_reserve", "knowledge_refund", "knowledge_service_reserve", "knowledge_service_refund",
		"planning_lecture_reserve", "planning_lecture_refund":
		return source[:strings.LastIndexByte(source, '_')]
	default:
		return ""
	}
}

type settlementKey struct {
	user, org, actor int
	kind, reference  string
}

func keyForCredit(row model.CreditLedger) settlementKey {
	actor := 0
	if row.OrgID > 0 {
		actor = row.ActorID
	}
	return settlementKey{row.UserID, row.OrgID, actor, settlementKind(row.Source), row.Reference}
}

func settledCreditRows(c *gin.Context, query *gorm.DB, page int) ([]model.CreditLedger, int64, int64, int64, error) {
	var candidates []model.CreditLedger
	if err := query.Find(&candidates).Error; err != nil {
		return nil, 0, 0, 0, err
	}
	rows := make([]model.CreditLedger, 0)
	groups := map[settlementKey][]model.CreditLedger{}
	refs := []string{}
	seen := map[string]bool{}
	for _, row := range candidates {
		key := keyForCredit(row)
		if key.kind == "" {
			rows = append(rows, row)
			continue
		}
		if key.reference == "" {
			continue
		}
		groups[key] = nil
		if !seen[key.reference] {
			seen[key.reference] = true
			refs = append(refs, key.reference)
		}
	}
	for i := 0; i < len(refs); i += 300 {
		batch := refs[i:min(i+300, len(refs))]
		var entries []model.CreditLedger
		if err := model.DB.Where("reference IN ?", batch).Order("occurred_at, id").Find(&entries).Error; err != nil {
			return nil, 0, 0, 0, err
		}
		for _, row := range entries {
			key := keyForCredit(row)
			if _, ok := groups[key]; ok {
				groups[key] = append(groups[key], row)
			}
		}
		var tasks []model.BillingTask
		if err := model.DB.Select("id", "user_id", "settled_at").Where("id IN ? AND state = ?", batch, "succeeded").Find(&tasks).Error; err != nil {
			return nil, 0, 0, 0, err
		}
		taskTimes := map[string]model.BillingTask{}
		for _, task := range tasks {
			taskTimes[task.ID] = task
		}
		var logs []model.Log
		if model.LOG_DB != nil {
			if err := model.LOG_DB.Select("request_id", "user_id", "org_id", "created_at", "quota").Where("request_id IN ? AND type = ? AND quota > 0", batch, model.LogTypeConsume).Find(&logs).Error; err != nil {
				return nil, 0, 0, 0, err
			}
		}
		modelTimes := map[settlementKey]int64{}
		for _, log := range logs {
			key := settlementKey{user: log.UserId, kind: "model", reference: log.RequestId}
			if log.OrgId > 0 {
				key.user = 0
				key.org = log.OrgId
				key.actor = log.UserId
			}
			modelTimes[key] = max(modelTimes[key], log.CreatedAt)
		}
		for _, entry := range entries {
			key := keyForCredit(entry)
			group := groups[key]
			if len(group) == 0 || entry.ID != group[len(group)-1].ID {
				continue
			}
			var settledAt int64
			if key.kind == "model" {
				settledAt = modelTimes[key]
				// A balance adjustment after the reservation is also evidence
				// of completion when model logging is disabled.
				for _, part := range group {
					if part.Source != "model_reserve" {
						settledAt = max(settledAt, part.OccurredAt)
					}
				}
			} else if task, ok := taskTimes[key.reference]; ok && task.UserID == key.user && task.SettledAt != nil {
				settledAt = task.SettledAt.Unix()
			}
			if settledAt == 0 {
				continue
			}
			row := group[len(group)-1]
			if key.kind != "model" {
				row.OccurredAt = settledAt
			}
			row.Source = key.kind + "_consume"
			row.Delta = 0
			for _, part := range group {
				row.Delta += part.Delta
			}
			if row.Delta >= 0 {
				continue
			}
			row.BalanceBefore = nil
			row.BalanceAfter = nil
			row.Entries = group
			rows = append(rows, row)
		}
	}
	start, end, _ := creditLedgerDates(c)
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].OccurredAt == rows[j].OccurredAt {
			return rows[i].ID > rows[j].ID
		}
		return rows[i].OccurredAt > rows[j].OccurredAt
	})
	var total, incoming, outgoing int64
	items := make([]model.CreditLedger, 0, 20)
	for _, row := range rows {
		if row.OccurredAt < start || row.OccurredAt >= end {
			continue
		}
		if source := c.Query("source"); source != "" && row.Source != source {
			continue
		}
		if (c.Query("direction") == "in" && row.Delta <= 0) || (c.Query("direction") == "out" && row.Delta >= 0) {
			continue
		}
		total++
		if row.Delta > 0 {
			incoming += row.Delta
		} else {
			outgoing -= row.Delta
		}
		if total > int64((page-1)*20) && len(items) < 20 {
			items = append(items, row)
		}
	}
	return items, total, incoming, outgoing, nil
}
