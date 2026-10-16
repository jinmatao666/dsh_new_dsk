package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

// ValidateInviteCode 验证邀请码并返回对应活动奖励信息
// GET /api/invite/validate?code=XXXX
func ValidateInviteCode(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "邀请码不能为空"})
		return
	}

	inviterId, err := model.GetUserIdByAffCode(code)
	if err != nil || inviterId == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"valid": false}})
		return
	}

	registrationActivities, _ := model.GetActiveActivitiesByTrigger("invite_registration")
	paymentActivities, _ := model.GetActiveActivitiesByTrigger("invite_payment")

	type activitySummary struct {
		TriggerType   string `json:"trigger_type"`
		GrantRole     string `json:"grant_role"`
		RewardSubtype string `json:"reward_subtype"`
		RewardAmount  int64  `json:"reward_amount"`
	}

	summaries := make([]activitySummary, 0)
	for _, a := range registrationActivities {
		summaries = append(summaries, activitySummary{
			TriggerType:   a.TriggerType,
			GrantRole:     a.GrantRole,
			RewardSubtype: a.RewardSubtype,
			RewardAmount:  a.RewardAmount,
		})
	}
	for _, a := range paymentActivities {
		summaries = append(summaries, activitySummary{
			TriggerType:   a.TriggerType,
			GrantRole:     a.GrantRole,
			RewardSubtype: a.RewardSubtype,
			RewardAmount:  a.RewardAmount,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"valid":      true,
			"activities": summaries,
		},
	})
}

// GetInviteActivities 获取当前有效的邀请奖励说明（公开，无需邀请码）
// 含邀请注册(invite_registration)与好友付费(invite_payment)两类，供前端向用户展示奖励额度。
// GET /api/invite/activities
func GetInviteActivities(c *gin.Context) {
	registrationActivities, _ := model.GetActiveActivitiesByTrigger("invite_registration")
	paymentActivities, _ := model.GetActiveActivitiesByTrigger("invite_payment")

	type activitySummary struct {
		TriggerType   string `json:"trigger_type"`
		GrantRole     string `json:"grant_role"`
		RewardSubtype string `json:"reward_subtype"`
		RewardAmount  int64  `json:"reward_amount"`
	}

	summaries := make([]activitySummary, 0)
	for _, a := range registrationActivities {
		summaries = append(summaries, activitySummary{
			TriggerType:   a.TriggerType,
			GrantRole:     a.GrantRole,
			RewardSubtype: a.RewardSubtype,
			RewardAmount:  a.RewardAmount,
		})
	}
	for _, a := range paymentActivities {
		summaries = append(summaries, activitySummary{
			TriggerType:   a.TriggerType,
			GrantRole:     a.GrantRole,
			RewardSubtype: a.RewardSubtype,
			RewardAmount:  a.RewardAmount,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": summaries})
}

// GET /api/user/invite
func GetMyInvite(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)

	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "用户不存在"})
		return
	}

	stats, err := model.GetInviteStats(userId)
	if err != nil {
		stats = &model.InviteStats{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"aff_code":       user.AffCode,
			"total_invitees": stats.TotalInvitees,
			"total_payments": stats.TotalPayments,
		},
	})
}

// GetMyInviteList 分页获取被邀请用户列表
// GET /api/user/invite/list?page=0&page_size=20
func GetMyInviteList(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "0"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	items, total, err := model.GetInviteList(userId, page, pageSize)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取邀请列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": items,
			"total": total,
		},
	})
}
