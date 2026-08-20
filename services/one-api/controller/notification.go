package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// ---- 客户端拉取 ----

// notificationView 客户端可见的通知(叠加已读/关闭状态)。
type notificationView struct {
	*model.Notification
	Read      bool `json:"read"`
	Dismissed bool `json:"dismissed"`
}

// GetPublicNotifications 公开(登录前/官网):返回 audience=all 的公告/服务通知。
// 无鉴权。按 platform+version 过滤(客户端传参)。
func GetPublicNotifications(c *gin.Context) {
	list, err := model.ListPublicNotifications()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	list = model.FilterByPlatformVersion(list, c.Query("platform"), c.Query("version"))
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": list})
}

// GetMyNotifications 登录用户:返回该用户可见的生效通知(已叠加定向 + 已读状态)。
func GetMyNotifications(c *gin.Context) {
	userId := c.GetInt("id")
	list, err := model.ListNotificationsForUser(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	list = model.FilterByPlatformVersion(list, c.Query("platform"), c.Query("version"))

	ids := make([]int, 0, len(list))
	for _, n := range list {
		ids = append(ids, n.Id)
	}
	readMap, err := model.GetUserReadMap(userId, ids)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	views := make([]notificationView, 0, len(list))
	for _, n := range list {
		v := notificationView{Notification: n}
		if r, ok := readMap[n.Id]; ok {
			v.Read = r.ReadAt != nil
			v.Dismissed = r.DismissedAt != nil
		}
		views = append(views, v)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": views})
}

// MarkMyNotificationRead 登录用户:标记某通知已读或关闭(?dismiss=true 为关闭)。
func MarkMyNotificationRead(c *gin.Context) {
	userId := c.GetInt("id")
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的ID"})
		return
	}
	dismiss := c.Query("dismiss") == "true"
	if err := model.MarkNotificationRead(userId, id, dismiss); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// ---- 后台配置(AdminAuth) ----

// AdminListNotifications 后台:列出通知(可按 category/status 过滤)。
func AdminListNotifications(c *gin.Context) {
	list, err := model.ListNotifications(c.Query("category"), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": list})
}

// AdminCreateNotification 后台:新建通知(默认 draft)。
func AdminCreateNotification(c *gin.Context) {
	var n model.Notification
	if err := c.ShouldBindJSON(&n); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	n.Id = 0
	if err := model.CreateNotification(&n); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": n})
}

// AdminUpdateNotification 后台:更新通知。
func AdminUpdateNotification(c *gin.Context) {
	var n model.Notification
	if err := c.ShouldBindJSON(&n); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if n.Id == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "ID不能为空"})
		return
	}
	if err := model.UpdateNotification(&n); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	// 若为已发布的广播平面服务通知，编辑后同步刷新广播文件。
	syncBroadcastIfNeeded(&n)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// AdminDeleteNotification 后台:删除通知。
func AdminDeleteNotification(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的ID"})
		return
	}
	if err := model.DeleteNotification(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// AdminPublishNotification 后台:发布/归档通知(?status=published|archived)。
// 发布 plane=B 的 service 通知时，额外渲染写广播文件推送更新服务器。
func AdminPublishNotification(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的ID"})
		return
	}
	status := c.DefaultQuery("status", model.NotificationStatusPublished)
	if status != model.NotificationStatusPublished && status != model.NotificationStatusArchived {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的状态"})
		return
	}
	if err := model.SetNotificationStatus(id, status); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	// 广播平面服务通知:发布/归档都需同步广播文件。
	if n, err := model.GetNotificationById(id); err == nil {
		syncBroadcastIfNeeded(n)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
