package controller

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/datasync"
)

// GetSyncStatus 返回同步功能可用性 + 源/目标库信息 + 模块清单（含源库各表行数）。
func GetSyncStatus(c *gin.Context) {
	status := datasync.Status()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    status,
	})
}

// syncRequest preview/execute 公共入参。
type syncRequest struct {
	Modules []string            `json:"modules"`
	Range   datasync.RangeSpec  `json:"range"`
	Confirm string              `json:"confirm"` // execute 专用：目标库名确认
}

// PreviewSync 预览每张表将同步行数与目标表现有行数。
func PreviewSync(c *gin.Context) {
	var req syncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数解析失败：" + err.Error()})
		return
	}
	if len(req.Modules) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请至少选择一个模块"})
		return
	}
	// 兜底：功能不可用时拒绝
	if status := datasync.CheckEnabled(); !status.Enabled {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": status.DisabledReason})
		return
	}
	res, err := datasync.Preview(req.Modules, req.Range)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "预览失败：" + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": res})
}

// ExecuteSync 创建后台同步任务。后端二次安全校验 + 目标库名确认 + 并发互斥。
func ExecuteSync(c *gin.Context) {
	var req syncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数解析失败：" + err.Error()})
		return
	}
	if len(req.Modules) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请至少选择一个模块"})
		return
	}

	// 二次安全校验（不依赖前端禁用）
	status := datasync.CheckEnabled()
	if !status.Enabled {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": status.DisabledReason})
		return
	}

	// 目标库名确认（仿删库交互）
	if strings.TrimSpace(req.Confirm) != status.TargetDB {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "确认口令与目标库名不一致，已取消"})
		return
	}

	// 并发互斥
	if datasync.RunningTaskExists() {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "已有同步任务正在执行，请等待其完成"})
		return
	}

	totalTables := datasync.CountTables(req.Modules)
	if totalTables == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "选中模块不包含任何有效表"})
		return
	}

	adminId := c.GetInt(ctxkey.Id)
	adminUsername := c.GetString(ctxkey.Username)
	adminRole := c.GetInt(ctxkey.Role)

	task := datasync.StartSync(req.Modules, req.Range, totalTables, func(t *datasync.Task) {
		// 任务完成回调：写一条后台操作审计
		detail := fmt.Sprintf("模块=%s 范围=%s 同步行数=%d 失败表数=%d 状态=%s",
			strings.Join(req.Modules, ","), req.Range.Mode, t.TotalRows, len(t.Errors), t.Status)
		_ = model.CreateAdminOperationLog(&model.AdminOperationLog{
			AdminId:       adminId,
			AdminUsername: adminUsername,
			AdminRole:     adminRole,
			Action:        "data_sync",
			Module:        "toolbox",
			TargetId:      status.TargetDB,
			Detail:        detail,
		})
	})

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"task_id": task.Id},
	})
}

// GetSyncTask 返回任务进度。
func GetSyncTask(c *gin.Context) {
	id := c.Param("id")
	task, ok := datasync.GetTask(id)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "任务不存在或已过期"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": task})
}
