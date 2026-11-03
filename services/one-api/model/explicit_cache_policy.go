package model

import (
	"net/url"
	"strings"

	"github.com/songquanpeng/one-api/relay/channeltype"
)

// 当前注入器适配百炼官方 OpenAI 兼容协议；自建及未知兼容渠道不注入显式缓存标记。
func ChannelAllowsExplicitCache(kind int, baseURL string) bool {
	if kind != channeltype.AliBailian && kind != channeltype.OpenAI {
		return false
	}
	if baseURL == "" {
		return kind == channeltype.AliBailian
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com":
		return true
	default:
		return false
	}
}
