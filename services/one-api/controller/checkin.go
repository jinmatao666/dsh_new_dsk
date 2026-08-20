package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

// GetCheckinStatus 用户签到状态：是否开启签到、今日是否已签、连续/累计天数、每次奖励积分。
// GET /api/user/checkin/status
//
// 签到已改为「使用后自动签到」：用户每日首次实际计费调用时，由 relay 侧
// TriggerFirstRequestDailyGuarded 触发 first_request(daily) 活动自动发放。
// 本接口仅供前端签到卡片展示状态，无手动领取入口。
func GetCheckinStatus(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	if userId == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请先登录"})
		return
	}
	activity, err := model.GetActiveSignInActivity()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if activity == nil {
		// 未配置/未上线签到活动，前端据此隐藏签到入口
		c.JSON(http.StatusOK, gin.H{"success": true, "data": &model.CheckinStats{Enabled: false}})
		return
	}
	stats, err := model.GetCheckinStats(activity, userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": stats})
}
