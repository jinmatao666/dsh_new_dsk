package controller

import (
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/billing"
	"github.com/songquanpeng/one-api/relay/meta"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// recordRelayErrorLog 在 relay 错误 return 路径写入一条不计费的错误日志。
// errMsg 会被截断到 200 字符并去除换行（与 timing 包 errorBrief 约定保持一致）。
//
// 设计要点：
//   - Quota=0：不进入 UpdateUserUsedQuotaAndRequestCount / UpdateChannelUsedQuota
//   - Type=LogTypeError：前端列表里渲染为红色"错误"标签
//   - 复用 billing.FillLogTimingFromGin 把 timing 字段一次性填上
//   - 同一次请求只写一条（由 RelayTextHelper 单一返回保证）
//   - req 允许为 nil（getAndValidateTextRequest 失败的极早期路径）
func recordRelayErrorLog(c *gin.Context, m *meta.Meta, req *relaymodel.GeneralOpenAIRequest, errMsg string) {
	if c == nil || m == nil {
		return
	}
	modelName := ""
	if req != nil {
		modelName = req.Model
	}
	if modelName == "" {
		modelName = m.OriginModelName
	}
	log := &model.Log{
		UserId:      m.UserId,
		ChannelId:   m.ChannelId,
		ModelName:   modelName,
		TokenName:   m.TokenName,
		Quota:       0,
		Content:     briefErrMsg(errMsg, 200),
		IsStream:    m.IsStream,
		ElapsedTime: helper.CalcElapsedTime(m.StartTime),
		OrgId:       orgIdFromMeta(m),
	}
	billing.FillLogTimingFromGin(c, log)
	model.RecordErrorLog(c.Request.Context(), log)
	model.FinishUserPromptAudit(c.Request.Context(), "error", errMsg, 0, 0, 0, log.ElapsedTime)
}

// recordImageRelayErrorLog 是 image.go 错误路径的简化版本：
// 不绑定 *relaymodel.GeneralOpenAIRequest，直接传 modelName 字符串。
// modelName 为空时回退到 m.OriginModelName。
func recordImageRelayErrorLog(c *gin.Context, m *meta.Meta, modelName, errMsg string) {
	if c == nil || m == nil {
		return
	}
	if modelName == "" {
		modelName = m.OriginModelName
	}
	log := &model.Log{
		UserId:      m.UserId,
		ChannelId:   m.ChannelId,
		ModelName:   modelName,
		TokenName:   m.TokenName,
		Quota:       0,
		Content:     briefErrMsg(errMsg, 200),
		IsStream:    m.IsStream,
		ElapsedTime: helper.CalcElapsedTime(m.StartTime),
		OrgId:       orgIdFromMeta(m),
	}
	billing.FillLogTimingFromGin(c, log)
	model.RecordErrorLog(c.Request.Context(), log)
}

// briefErrMsg 把错误消息压成单行并截断到 n 个字节。
// 中文场景下按 byte 截断可能切到多字节字符中间，但只用于排障展示，可接受。
func briefErrMsg(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func orgIdFromMeta(m *meta.Meta) int {
	if m.UseOrgQuota {
		return m.OrgId
	}
	return 0
}
