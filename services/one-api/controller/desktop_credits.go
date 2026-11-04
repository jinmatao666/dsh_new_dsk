package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"net/http"
	"sort"
	"strconv"
	"time"
)

func DesktopCheckin(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	if c.Request.Method == "POST" {
		if err := model.ClaimDesktopCheckin(id); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
	}
	status, err := model.GetDesktopCheckinStatus(id)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "读取签到状态失败"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": status})
}

type desktopCreditItem struct {
	Id      string   `json:"id"`
	Time    int64    `json:"time"`
	Name    string   `json:"name"`
	Credits float64  `json:"credits"`
	Balance *float64 `json:"balance"`
}

func GetDesktopCredits(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 0 || page > 1000 {
		page = 0
	}
	filter := c.Query("filter")
	limit := (page + 1) * 20
	unit := config.QuotaPerUnit
	if unit <= 0 {
		c.JSON(500, gin.H{"success": false, "message": "积分换算配置无效"})
		return
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "读取余额失败"})
		return
	}
	items := []desktopCreditItem{}
	var total int64
	fail := func() { c.JSON(500, gin.H{"success": false, "message": "读取积分明细失败"}) }
	if filter != "spent" {
		var rows []model.UserTimedQuota
		var count int64
		q := model.DB.Model(&model.UserTimedQuota{}).Where("user_id = ?", id)
		if q.Count(&count).Error != nil || q.Order("id DESC").Limit(limit).Find(&rows).Error != nil {
			fail()
			return
		}
		total += count
		var receipts []model.DesktopCheckinReceipt
		if model.DB.Where("user_id = ?", id).Order("id DESC").Limit(limit).Find(&receipts).Error != nil {
			fail()
			return
		}
		var adminGrants []model.AdminCreditGrant
		if model.DB.Where("user_id = ?", id).Order("created_at DESC").Limit(limit).Find(&adminGrants).Error != nil {
			fail()
			return
		}
		adminBalances := map[string]float64{}
		for _, grant := range adminGrants {
			adminBalances[grant.Reference] = float64(grant.BalanceAfter) / unit
		}
		balances := map[string]float64{}
		for _, r := range receipts {
			balances[r.Day] = float64(r.BalanceAfter) / unit
		}
		names := map[string]string{"checkin": "签到赠送", "register": "注册赠送", "admin": "管理员赠送", "topup": "充值到账", "redeem": "兑换到账", "refund": "退款到账"}
		for _, r := range rows {
			name := names[r.Source]
			if name == "" {
				name = "积分到账"
			}
			var balance *float64
			if r.Source == "admin" {
				if b, ok := adminBalances[r.SourceRef]; ok {
					copy := b
					balance = &copy
				}
			}
			if r.Source == "checkin" {
				if b, ok := balances[r.SourceRef]; ok {
					copy := b
					balance = &copy
				}
			}
			items = append(items, desktopCreditItem{Id: "grant-" + strconv.FormatInt(r.Id, 10), Time: r.CreatedAt.Unix(), Name: name, Credits: float64(r.Amount) / unit, Balance: balance})
		}
	}
	if filter != "earned" {
		var rows []model.Log
		var count int64
		q := model.LOG_DB.Model(&model.Log{}).Where("user_id = ? AND type = ?", id, model.LogTypeConsume)
		if q.Count(&count).Error != nil || q.Order("id DESC").Limit(limit).Find(&rows).Error != nil {
			fail()
			return
		}
		total += count
		for _, r := range rows {
			var receipt struct {
				Refunded int64  `json:"refunded_quota"`
				Status   string `json:"status"`
			}
			_ = json.Unmarshal([]byte(r.CreditBilling), &receipt)
			label := "模型调用 · " + r.ModelName
			if receipt.Status == "refunded" {
				label = "预扣退回 · " + r.ModelName
			}
			if receipt.Refunded > 0 {
				label += "（退回预扣 " + strconv.FormatFloat(float64(receipt.Refunded)/unit, 'f', -1, 64) + " 积分）"
			}
			items = append(items, desktopCreditItem{Id: "consume-" + strconv.Itoa(r.Id), Time: r.CreatedAt, Name: label, Credits: -float64(r.Quota) / unit})
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Time == items[j].Time {
			return items[i].Id > items[j].Id
		}
		return items[i].Time > items[j].Time
	})
	start := page * 20
	if start > len(items) {
		start = len(items)
	}
	end := start + 20
	if end > len(items) {
		end = len(items)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": gin.H{"balance": float64(user.Quota) / unit, "items": items[start:end], "total": total}})
}

// DesktopCreditAvailability checks live, unexpired credits before task side effects.
func DesktopCreditAvailability(c *gin.Context) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	var settings struct {
		Edition string `json:"edition"`
	}
	_ = json.Unmarshal([]byte(raw), &settings)
	enabled := settings.Edition == "operations"
	var account model.User
	if err := model.DB.Select("account_type").First(&account, c.GetInt(ctxkey.Id)).Error; err != nil {
		c.JSON(401, gin.H{"success": false, "message": "用户身份无效"})
		return
	}
	if account.AccountType == model.AccountTypeEnterprise {
		enabled = false
	}
	var available int64
	if enabled {
		if err := model.DB.Model(&model.UserTimedQuota{}).Where("user_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > ?)", c.GetInt(ctxkey.Id), time.Now()).Select("COALESCE(SUM(remaining),0)").Scan(&available).Error; err != nil {
			c.JSON(500, gin.H{"success": false, "message": "无法确认积分余额"})
			return
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": gin.H{"enabled": enabled, "available": !enabled || available > 0}})
}
