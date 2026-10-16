package controller

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// Plane B 广播文件:与 one-api DB 解耦的静态急件通道。
// one-api 与 nginx 更新服务器目录(/var/www/parvis-updates)同宿主时,直接写本地文件即可,
// nginx 直出 /parvis-updates/broadcast/service-broadcast.json。one-api 挂掉也不影响该文件被读取。
// 落盘路径由环境变量 BROADCAST_FILE_PATH 指定,未配置则跳过写入(仅本地开发/未部署广播时)。

// broadcastPayload 是客户端/官网轮询的广播文件结构。
// active=false 或文件不存在 => 客户端撤下阻断层。
type broadcastPayload struct {
	Active      bool   `json:"active"`
	Id          int    `json:"id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	Blocking    bool   `json:"blocking"`
	Dismissible bool   `json:"dismissible"`
	Action      string `json:"action,omitempty"`
	Platforms   string `json:"platforms,omitempty"`
	MinVersion  string `json:"min_version,omitempty"`
	MaxVersion  string `json:"max_version,omitempty"`
	UpdatedAt   string `json:"updated_at"`
}

// broadcastFilePath 返回广播文件落盘绝对路径,未配置返回空串。
func broadcastFilePath() string {
	dir := os.Getenv("BROADCAST_FILE_PATH")
	if dir == "" {
		// 兼容:也可用 Option 配置,便于后台改路径而不重启。
		dir = config.OptionMap["BroadcastFilePath"]
	}
	return dir
}

// SyncServiceBroadcast 依据当前生效的 Plane B service 通知,重写广播文件。
// 取优先级最高的一条阻断级通知写入;无则写 active:false(撤下阻断层)。
// publish/下线/删除 service 通知后都应调用,保持广播文件与 DB 一致。
func SyncServiceBroadcast() {
	path := broadcastFilePath()
	if path == "" {
		logger.SysLog("广播文件路径未配置(BROADCAST_FILE_PATH),跳过 Plane B 同步")
		return
	}

	payload := broadcastPayload{Active: false, UpdatedAt: time.Now().Format(time.RFC3339)}

	list, err := model.ListPlaneBBroadcastNotifications()
	if err != nil {
		logger.SysError("查询 Plane B 通知失败: " + err.Error())
		return
	}
	if len(list) > 0 {
		n := list[0] // 已按 priority desc 排序,取最高优先级
		payload = broadcastPayload{
			Active:      true,
			Id:          n.Id,
			Title:       n.Title,
			Content:     n.Content,
			Blocking:    n.Blocking,
			Dismissible: n.Dismissible,
			Action:      n.ActionJSON,
			Platforms:   n.Platforms,
			MinVersion:  n.MinVersion,
			MaxVersion:  n.MaxVersion,
			UpdatedAt:   time.Now().Format(time.RFC3339),
		}
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		logger.SysError("序列化广播文件失败: " + err.Error())
		return
	}

	// 原子写:先写临时文件再 rename,避免 nginx 读到半截 JSON。
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		logger.SysError("创建广播目录失败: " + err.Error())
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		logger.SysError("写广播临时文件失败: " + err.Error())
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		logger.SysError("替换广播文件失败: " + err.Error())
		return
	}
	logger.SysLog("Plane B 广播文件已更新: active=" + boolStr(payload.Active))
}

// syncBroadcastIfNeeded 仅当通知属于广播平面(B)通知类时，刷新广播文件。
// 其它平面/站内信不落广播文件，避免无谓写盘。
func syncBroadcastIfNeeded(n *model.Notification) {
	if n == nil {
		return
	}
	if n.Plane == model.NotificationPlaneB && n.Category == model.NotificationCategoryNotification {
		SyncServiceBroadcast()
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
