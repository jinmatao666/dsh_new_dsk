package controller

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func creditLedgerDates(c *gin.Context) (int64, int64, error) {
	zone := time.FixedZone("CST", 8*3600)
	now := time.Now().In(zone)
	start, err := time.ParseInLocation("2006-01-02", c.DefaultQuery("from", now.AddDate(0, 0, -29).Format("2006-01-02")), zone)
	if err != nil {
		return 0, 0, err
	}
	end, err := time.ParseInLocation("2006-01-02", c.DefaultQuery("to", now.Format("2006-01-02")), zone)
	if err != nil || start.After(end) || end.Sub(start) > 366*24*time.Hour {
		return 0, 0, strconv.ErrSyntax
	}
	return start.Unix(), end.AddDate(0, 0, 1).Unix(), nil
}

func creditLedgerQuery(c *gin.Context) (*gorm.DB, error) {
	start, end, err := creditLedgerDates(c)
	if err != nil {
		return nil, err
	}
	q := model.DB.Model(&model.CreditLedger{})
	if c.Query("view") == "settled" {
		taskIDs := model.DB.Model(&model.BillingTask{}).Select("id").Where("state = ? AND settled_at >= ? AND settled_at < ?", "succeeded", time.Unix(start, 0), time.Unix(end, 0))
		q = q.Where("((occurred_at >= ? AND occurred_at < ?) OR reference IN (?))", start, end, taskIDs)
	} else {
		q = q.Where("occurred_at >= ? AND occurred_at < ?", start, end)
	}
	for _, field := range []string{"user_id", "actor_id"} {
		if raw := c.Query(field); raw != "" {
			id, err := strconv.Atoi(raw)
			if err != nil || id < 0 {
				return nil, strconv.ErrSyntax
			}
			if field == "user_id" {
				q = q.Where("(user_id = ? OR (org_id > 0 AND actor_id = ?))", id, id)
			} else {
				q = q.Where(field+" = ?", id)
			}
		}
	}
	if source := c.Query("source"); source != "" && c.Query("view") != "settled" {
		q = q.Where("source = ?", source)
	}
	switch c.Query("direction") {
	case "in":
		if c.Query("view") != "settled" {
			q = q.Where("delta > 0")
		}
	case "out":
		if c.Query("view") != "settled" {
			q = q.Where("delta < 0")
		}
	case "", "all":
	default:
		return nil, strconv.ErrSyntax
	}
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		if len([]rune(keyword)) > 100 {
			return nil, strconv.ErrSyntax
		}
		pattern := "%" + strings.ToLower(keyword) + "%"
		// A search matches both saved ledger identities and current profile fields.
		q = q.Where(`(LOWER(username) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(department_name) LIKE ? OR LOWER(unit_name) LIKE ? OR LOWER(actor_name) LIKE ? OR LOWER(reference) LIKE ? OR LOWER(description) LIKE ? OR user_id IN (SELECT id FROM users WHERE LOWER(username) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(email) LIKE ? OR LOWER(unit_name) LIKE ? OR LOWER(department_name) LIKE ?))`, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern)
	}
	return q, nil
}

func GetCreditLedger(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	query, err := creditLedgerQuery(c)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "筛选条件无效，日期范围不能超过一年"})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	if page > 100000 {
		page = 100000
	}
	var summary struct {
		Total    int64 `json:"total"`
		Incoming int64 `json:"incoming"`
		Outgoing int64 `json:"outgoing"`
	}
	rows := []model.CreditLedger{}
	if c.Query("view") == "settled" {
		rows, summary.Total, summary.Incoming, summary.Outgoing, err = settledCreditRows(c, query, page)
		if err != nil {
			c.JSON(500, gin.H{"success": false, "message": "积分结算明细加载失败"})
			return
		}
	} else {
		if err = query.Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END),0) AS incoming, COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END),0) AS outgoing").Scan(&summary).Error; err != nil {
			c.JSON(500, gin.H{"success": false, "message": "积分统计加载失败"})
			return
		}
		query, _ = creditLedgerQuery(c)
		if err = query.Order("occurred_at DESC, id DESC").Limit(20).Offset((page - 1) * 20).Find(&rows).Error; err != nil {
			c.JSON(500, gin.H{"success": false, "message": "积分台账加载失败"})
			return
		}
	}
	references := make([]string, 0, len(rows))
	for _, row := range rows {
		if strings.HasSuffix(row.Source, "_reserve") || strings.HasSuffix(row.Source, "_refund") {
			references = append(references, row.Reference)
		}
	}
	if len(references) > 0 {
		var tasks []model.BillingTask
		if err := model.DB.Select("id", "state").Where("id IN ?", references).Find(&tasks).Error; err != nil {
			c.JSON(500, gin.H{"success": false, "message": "计费状态读取失败"})
			return
		}
		states := map[string]string{}
		for _, task := range tasks {
			states[task.ID] = task.State
		}
		for i := range rows {
			rows[i].TaskState = states[rows[i].Reference]
		}
	}
	historyStatus := "complete"
	var history model.CreditLedgerMigration
	if err := model.DB.Where("id = ?", "history-v1").Find(&history).Error; err != nil {
		c.JSON(500, gin.H{"success": false, "message": "积分历史状态读取失败"})
		return
	}
	if history.ID != "" && !history.Complete {
		historyStatus = "importing"
		if history.Failed {
			historyStatus = "failed"
		}
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": rows, "total": summary.Total, "incoming": summary.Incoming, "outgoing": summary.Outgoing, "page": page, "history_status": historyStatus, "audit_since": history.Cutoff, "quota_per_credit": config.QuotaPerUnit}})
}
