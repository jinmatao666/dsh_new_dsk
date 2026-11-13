package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"strconv"
)

// GetDesktopTurnCredits reads settled charges for this account and exact session/turn.
// Missing historical attribution is returned as no records, never inferred from a balance delta.
func GetDesktopTurnCredits(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := c.GetInt(ctxkey.Id)
	if config.CreditsDisabled() {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": false}})
		return
	}
	var user model.User
	if err := model.DB.Select("id", "account_type").First(&user, id).Error; err != nil {
		c.JSON(401, gin.H{"success": false, "message": "用户身份无效"})
		return
	}
	if user.AccountType == model.AccountTypeEnterprise {
		c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": false}})
		return
	}
	session := c.Query("session_id")
	turn, err := strconv.Atoi(c.Query("turn_id"))
	if err != nil || turn < 0 || session == "" || len(session) > 128 || config.QuotaPerUnit <= 0 {
		c.JSON(400, gin.H{"success": false, "message": "会话积分参数无效"})
		return
	}
	fail := func() { c.JSON(500, gin.H{"success": false, "message": "读取本轮积分失败"}) }
	var logs []model.Log
	if err := model.LOG_DB.Where("user_id = ? AND type = ? AND credit_session_id = ? AND credit_turn_id = ?", id, model.LogTypeConsume, session, turn).Order("id").Find(&logs).Error; err != nil {
		fail()
		return
	}
	var tasks []model.BillingTask
	if err := model.DB.Where("user_id = ? AND session_id = ? AND turn_id = ? AND state IN ?", id, session, turn, []string{"succeeded", "reserved"}).Order("created_at").Find(&tasks).Error; err != nil {
		fail()
		return
	}
	items := []desktopCreditItem{}
	var quota int64
	pending := false
	for _, row := range logs {
		quota += int64(row.Quota)
		items = append(items, desktopCreditItem{Id: "consume-" + strconv.Itoa(row.Id), Time: row.CreatedAt, Name: "模型调用 · " + row.ModelName, Credits: -float64(row.Quota) / config.QuotaPerUnit})
	}
	for _, task := range tasks {
		if task.State == "reserved" {
			pending = true
			continue
		}
		if task.Quota <= 0 {
			continue
		}
		quota += task.Quota
		balance := float64(task.BalanceAfter) / config.QuotaPerUnit
		items = append(items, desktopCreditItem{Id: "business-" + task.ID, Time: task.CreatedAt.Unix(), Name: businessCreditLabel(task), Credits: -float64(task.Quota) / config.QuotaPerUnit, Balance: &balance})
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": true, "credits": float64(quota) / config.QuotaPerUnit, "items": items, "pending": pending}})
}

func businessCreditLabel(task model.BillingTask) string {
	kind := map[string]string{"skill": "技能调用", "expert": "专家调用", "knowledge": "知识库调用"}[task.Kind]
	if kind == "" {
		kind = "服务调用"
	}
	label := kind + " · " + task.ItemID
	if task.Action != "default" && task.Action != "" {
		label += " · " + task.Action
	}
	if task.Description != "" {
		label += " · " + task.Description
	}
	return label
}
