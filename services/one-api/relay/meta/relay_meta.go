package meta

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/channeltype"
	"github.com/songquanpeng/one-api/relay/relaymode"
)

type Meta struct {
	Mode         int
	ChannelType  int
	ChannelId    int
	TokenId      int
	TokenName    string
	UserId       int
	Group        string
	ModelMapping map[string]string
	// BaseURL is the proxy url set in the channel config
	BaseURL  string
	APIKey   string
	APIType  int
	Config   model.ChannelConfig
	IsStream bool
	// OriginModelName is the model name from the raw user request
	OriginModelName string
	// ActualModelName is the model name after mapping
	ActualModelName    string
	RequestURLPath     string
	PromptTokens       int // only for DoResponse
	ForcedSystemPrompt string
	StartTime          time.Time
	// Organization fields
	OrgId               int
	OrgMemberId         int
	OrgDeptId           int
	UseOrgQuota         bool
	OrgMemberQuotaLimit int64
	// OrgPreConsumedDeducted 记录预扣时按账本顺序扣减的明细(rowId -> amount),
	// 用于 post 阶段精确退款.企业模式下由 preConsumeQuota 写入,postConsume/Return 路径读取.
	OrgPreConsumedDeducted map[int64]int64
}

func GetByContext(c *gin.Context) *Meta {
	meta := Meta{
		Mode:               relaymode.GetByPath(c.Request.URL.Path),
		ChannelType:        c.GetInt(ctxkey.Channel),
		ChannelId:          c.GetInt(ctxkey.ChannelId),
		TokenId:            c.GetInt(ctxkey.TokenId),
		TokenName:          c.GetString(ctxkey.TokenName),
		UserId:             c.GetInt(ctxkey.Id),
		Group:              c.GetString(ctxkey.Group),
		ModelMapping:       c.GetStringMapString(ctxkey.ModelMapping),
		OriginModelName:    c.GetString(ctxkey.RequestModel),
		BaseURL:            c.GetString(ctxkey.BaseURL),
		APIKey:             strings.TrimPrefix(c.Request.Header.Get("Authorization"), "Bearer "),
		RequestURLPath:     c.Request.URL.String(),
		ForcedSystemPrompt: c.GetString(ctxkey.SystemPrompt),
		StartTime:          time.Now(),
		OrgId:              c.GetInt(ctxkey.OrgId),
		OrgMemberId:        c.GetInt(ctxkey.OrgMemberId),
		OrgDeptId:          c.GetInt(ctxkey.OrgDeptId),
		UseOrgQuota:        c.GetBool(ctxkey.UseOrgQuota),
	}
	if quotaLimit, exists := c.Get(ctxkey.OrgMemberQuotaLimit); exists {
		meta.OrgMemberQuotaLimit = quotaLimit.(int64)
	} else {
		meta.OrgMemberQuotaLimit = -1
	}
	cfg, ok := c.Get(ctxkey.Config)
	if ok {
		meta.Config = cfg.(model.ChannelConfig)
	}
	if meta.BaseURL == "" {
		meta.BaseURL = channeltype.ChannelBaseURLs[meta.ChannelType]
	}
	meta.APIType = channeltype.ToAPIType(meta.ChannelType)
	return &meta
}
