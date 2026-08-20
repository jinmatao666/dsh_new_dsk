package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// AdminListActivities 后台:列出全部活动
func AdminListActivities(c *gin.Context) {
	activities, err := model.GetAllActivities()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": activities})
}

// AdminGetActivity 后台:获取单个活动
func AdminGetActivity(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的活动ID"})
		return
	}
	activity, err := model.GetActivityById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": activity})
}

// AdminCreateActivity 后台:新建活动
func AdminCreateActivity(c *gin.Context) {
	var activity model.Activity
	if err := c.ShouldBindJSON(&activity); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	activity.Id = 0
	if err := checkActivityConflict(c, &activity, 0); err != nil {
		return // checkActivityConflict 已写响应
	}
	if err := model.CreateActivity(&activity); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": activity})
}

// checkActivityConflict 校验「同触发事件 + 同奖励角色」是否已有生效活动。
// 仅当目标活动为 active 时校验；命中冲突且未带管理员密码 → 返回 conflict 提示（前端弹密码框）；
// 带了管理员密码则校验通过后放行。返回非 nil 表示已写响应、调用方应直接 return。
func checkActivityConflict(c *gin.Context, activity *model.Activity, excludeId int) error {
	if activity.Status != "active" {
		return nil
	}
	conflictName, err := model.FindConflictingActiveActivity(activity.TriggerType, activity.GrantRole, excludeId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return err
	}
	if conflictName == "" {
		return nil // 无冲突
	}
	// 有冲突：未带密码 → 让前端弹二次确认
	if activity.AdminPassword == "" {
		c.JSON(http.StatusOK, gin.H{
			"success":       false,
			"conflict":      true,
			"conflict_name": conflictName,
			"message":       fmt.Sprintf("已存在生效中的同类活动「%s」，两者会同时生效并可能重复发放。确认继续请输入管理员密码。", conflictName),
		})
		return errActivityConflict
	}
	// 带了密码 → 校验
	if err := validateCurrentAdminPassword(c, activity.AdminPassword); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return err
	}
	return nil // 密码通过，放行
}

var errActivityConflict = errors.New("activity conflict")

// AdminUpdateActivity 后台:更新活动
func AdminUpdateActivity(c *gin.Context) {
	var activity model.Activity
	if err := c.ShouldBindJSON(&activity); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if activity.Id == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "活动ID不能为空"})
		return
	}
	if err := checkActivityConflict(c, &activity, activity.Id); err != nil {
		return // checkActivityConflict 已写响应
	}
	if err := model.UpdateActivity(&activity); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// AdminDeleteActivity 后台:删除活动
func AdminDeleteActivity(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的活动ID"})
		return
	}
	if err := model.DeleteActivity(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// ClaimActivity 用户手动领取活动
func ClaimActivity(c *gin.Context) {
	userId := c.GetInt("id")
	if userId == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请先登录"})
		return
	}

	activityId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的活动ID"})
		return
	}

	// 获取活动
	activity, err := model.GetActivityById(activityId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "活动不存在"})
		return
	}

	// 检查是否手动领取类型
	if activity.TriggerType != "manual" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该活动不支持手动领取"})
		return
	}

	// 检查活动是否有效
	if !activity.IsActive() {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "活动已过期或未开始"})
		return
	}

	// 检查用户是否匹配
	match, err := activity.MatchUser(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "检查用户资格失败"})
		return
	}
	if !match {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "不符合领取条件"})
		return
	}

	// 检查是否已领取
	grantLimit := activity.GrantLimit
	if grantLimit == "" {
		grantLimit = "once"
	}
	participated, err := model.HasParticipated(activity.Id, userId, grantLimit)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "检查领取记录失败"})
		return
	}
	if participated {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "已领取过该活动"})
		return
	}

	// 发放奖励
	err = model.GrantActivityReward(c.Request.Context(), userId, activity)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "领取成功"})
}

// AdminGrantActivityManually 后台：手动发放活动（人群定向型）
func AdminGrantActivityManually(c *gin.Context) {
	activityId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的活动ID"})
		return
	}

	// 发放给目标人群
	err = model.GrantToCrowd(c.Request.Context(), activityId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "发放成功"})
}

