package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/channeltype"
)

const webSearchHeader = "X-Dsh-Web-Search"

// BindConfiguredWebSearchRoute turns an explicitly marked chat completion into
// the administrator-selected Bailian search route. Ordinary completions pass
// through unchanged.
func BindConfiguredWebSearchRoute() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader(webSearchHeader) != "1" {
			c.Next()
			return
		}
		config.OptionMapRWMutex.RLock()
		searchModel := strings.TrimSpace(config.OptionMap["SearchModel"])
		channelValue := strings.TrimSpace(config.OptionMap["SearchChannelId"])
		config.OptionMapRWMutex.RUnlock()
		if searchModel == "" || channelValue == "" {
			abortWithMessage(c, http.StatusServiceUnavailable, "web search model is not configured")
			return
		}
		if !bailianModelSupportsWebSearch(searchModel) {
			abortWithMessage(c, http.StatusServiceUnavailable, "configured model does not support Bailian web search")
			return
		}
		if c.GetString(ctxkey.RequestModel) != searchModel {
			abortWithMessage(c, http.StatusBadRequest, "web search request model does not match the configured model")
			return
		}
		channelID, err := strconv.Atoi(channelValue)
		if err != nil {
			abortWithMessage(c, http.StatusServiceUnavailable, "web search channel configuration is invalid")
			return
		}
		channel, err := model.GetChannelById(channelID, true)
		if err != nil || channel.Status != model.ChannelStatusEnabled || channel.Type != channeltype.AliBailian {
			abortWithMessage(c, http.StatusServiceUnavailable, "configured web search channel is unavailable")
			return
		}
		sources, err := model.GetModelChannelSources(searchModel)
		if err != nil {
			abortWithMessage(c, http.StatusServiceUnavailable, "cannot validate the web search model source")
			return
		}
		matched := false
		for _, source := range sources {
			if source.ChannelId == channelID && source.Enabled && source.Status == model.ChannelStatusEnabled {
				matched = true
				break
			}
		}
		if !matched {
			abortWithMessage(c, http.StatusServiceUnavailable, "web search model is not bound to the configured channel")
			return
		}
		c.Set(ctxkey.SpecificChannelId, strconv.Itoa(channelID))
		c.Set(ctxkey.WebSearch, true)
		c.Next()
	}
}

func bailianModelSupportsWebSearch(modelName string) bool {
	name := strings.ToLower(strings.TrimSpace(modelName))
	prefixes := []string{
		"qwen3.5-plus", "qwen3.5-flash",
		"qwen3.6-plus", "qwen3.6-flash",
		"qwen3.7-plus", "qwen3.7-flash", "qwen3.7-max",
		"qwen3.8-flash", "qwen3.8-max",
		"qwen3-max", "qwen-plus", "qwen-flash", "qwen-turbo", "qwen-max",
		"qwq-plus",
	}
	for _, prefix := range prefixes {
		if name == prefix || strings.HasPrefix(name, prefix+"-") {
			return true
		}
	}
	return false
}
