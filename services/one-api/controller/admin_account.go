package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

// TransferUserToOrgRequest body 与 admin password 校验由控制器内完成.
type TransferUserToOrgRequest struct {
	OrgId         int    `json:"org_id"`
	Role          string `json:"role"`
	Reason        string `json:"reason"`
	AdminPassword string `json:"admin_password"`
}

// TransferUserToOrg 平台管理员把指定个体用户转入企业.
//
// POST /api/admin/user/:id/transfer-to-org
func TransferUserToOrg(c *gin.Context) {
	userIdStr := c.Param("id")
	userId, err := strconv.Atoi(userIdStr)
	if err != nil || userId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	var req TransferUserToOrgRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.OrgId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请选择目标企业"})
		return
	}
	if err := validateCurrentAdminPassword(c, req.AdminPassword); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	adminId := c.GetInt(ctxkey.Id)
	if err := model.TransferToEnterprise(adminId, userId, req.OrgId, req.Role, req.Reason); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "转入完成,用户个人积分已清零"})
}

// TransferUserToPersonalRequest 出企请求.
type TransferUserToPersonalRequest struct {
	Reason        string `json:"reason"`
	AdminPassword string `json:"admin_password"`
}

// TransferUserToPersonal 平台管理员把指定企业用户转出为个体身份(个人积分不恢复).
//
// POST /api/admin/user/:id/transfer-to-personal
func TransferUserToPersonal(c *gin.Context) {
	userIdStr := c.Param("id")
	userId, err := strconv.Atoi(userIdStr)
	if err != nil || userId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	var req TransferUserToPersonalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := validateCurrentAdminPassword(c, req.AdminPassword); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	adminId := c.GetInt(ctxkey.Id)
	if err := model.TransferToPersonal(adminId, userId, req.Reason); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "转出完成,该用户已恢复为个体身份"})
}

// PreviewUserTransferToOrg 在转入前返回将被清零的资产快照,供前端弹窗显示.
//
// GET /api/admin/user/:id/transfer-preview
func PreviewUserTransferToOrg(c *gin.Context) {
	userIdStr := c.Param("id")
	userId, err := strconv.Atoi(userIdStr)
	if err != nil || userId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	breakdown, _ := model.GetUserTimedQuotaBreakdown(userId)
	subs, _ := model.GetActiveSubscriptionsByUserId(userId)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"user_id":               user.Id,
			"username":              user.Username,
			"account_type":          user.AccountType,
			"org_id":                user.OrgId,
			"quota":                 user.Quota,
			"subscription_quota":    user.SubscriptionQuota,
			"timed_quota_total":     user.TimedQuotaTotal,
			"timed_quota_breakdown": breakdown,
			"active_subscriptions":  subs,
		},
	})
}

// ListAccountTypeChanges 平台管理员审计列表.
//
// GET /api/admin/account-type-changes?page=&size=&user_id=&direction=
func ListAccountTypeChanges(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "0"))
	if page < 0 {
		page = 0
	}
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if size <= 0 || size > 100 {
		size = 20
	}
	userId, _ := strconv.Atoi(c.Query("user_id"))
	direction := c.Query("direction")

	q := model.DB.Model(&model.AccountTypeChange{})
	if userId > 0 {
		q = q.Where("user_id = ?", userId)
	}
	if direction != "" {
		q = q.Where("direction = ?", direction)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	var rows []model.AccountTypeChange
	if err := q.Order("id desc").Offset(page * size).Limit(size).Find(&rows).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"total": total,
			"items": rows,
		},
	})
}
