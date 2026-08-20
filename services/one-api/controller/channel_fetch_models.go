package controller

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/channeltype"
)

// 渠道自动获取可用模型列表（打上游 GET {baseURL}/v1/models）
//
// 第一阶段仅支持 OpenAI 兼容协议的渠道类型：OpenAI / Anthropic（官转走 OpenAI 协议）/
// Custom / OpenAICompatible，以及 openai.CompatibleChannels 列表内的类型。
// 其余类型（Gemini 原生、文心、讯飞等）协议各异，返回明确错误，保留手填。

// canAutoFetchModels 判断渠道类型是否支持自动拉取 /v1/models。
func canAutoFetchModels(channelType int) bool {
	switch channelType {
	case channeltype.OpenAI, channeltype.Anthropic, channeltype.Custom,
		channeltype.OpenAICompatible, channeltype.GeminiOpenAICompatible,
		channeltype.AliBailian:
		return true
	}
	for _, t := range openai.CompatibleChannels {
		if t == channelType {
			return true
		}
	}
	return false
}

// modelsEndpoint 按渠道类型拼出「列模型」接口地址。
// 多数 OpenAI 兼容渠道为 {baseURL}/v1/models；阿里云百炼的兼容模式带专属前缀
// {baseURL}/compatible-mode/v1/models（base 仍为 https://dashscope.aliyuncs.com）。
func modelsEndpoint(channelType int, baseURL string) string {
	base := strings.TrimRight(baseURL, "/")
	switch channelType {
	case channeltype.AliBailian:
		// 若用户已自行填到 /compatible-mode 结尾，避免重复拼接。
		if strings.HasSuffix(base, "/compatible-mode") {
			return base + "/v1/models"
		}
		return base + "/compatible-mode/v1/models"
	case channeltype.GeminiOpenAICompatible:
		// Gemini 兼容默认 baseURL 已含 /v1beta/openai 前缀，直接挂 /models，
		// 不再追加 /v1（否则会得到 .../openai/v1/models 而 404）。
		if strings.Contains(base, "/openai") {
			return base + "/models"
		}
		return base + "/v1/models"
	default:
		return base + "/v1/models"
	}
}

// resolveBaseURL 取渠道 baseURL，空则回退到渠道类型默认地址。
func resolveBaseURL(channelType int, baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL != "" {
		return baseURL
	}
	if channelType >= 0 && channelType < len(channeltype.ChannelBaseURLs) {
		return strings.TrimRight(channeltype.ChannelBaseURLs[channelType], "/")
	}
	return ""
}

type upstreamModelsResponse struct {
	Data []struct {
		Id string `json:"id"`
	} `json:"data"`
}

// fetchUpstreamModels 用给定凭证打上游 /v1/models，返回去重后的模型名列表。
func fetchUpstreamModels(channelType int, key, baseURL string) ([]string, error) {
	resolved := resolveBaseURL(channelType, baseURL)
	if resolved == "" {
		return nil, fmt.Errorf("无法确定上游地址，请先填写 BaseURL")
	}
	// 多 key（换行分隔）时取第一个用于探测。
	if idx := strings.IndexAny(key, "\n"); idx >= 0 {
		key = key[:idx]
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, fmt.Errorf("缺少密钥，无法获取模型列表")
	}

	url := modelsEndpoint(channelType, resolved)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求上游失败：%s", err.Error())
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取上游响应失败：%s", err.Error())
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("上游返回 %d：%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed upstreamModelsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("解析上游响应失败：%s", err.Error())
	}
	if len(parsed.Data) == 0 {
		return nil, fmt.Errorf("上游未返回任何模型（响应缺少 data 字段或为空）")
	}

	seen := make(map[string]struct{}, len(parsed.Data))
	models := make([]string, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		id := strings.TrimSpace(m.Id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		models = append(models, id)
	}
	if len(models) == 0 {
		return nil, fmt.Errorf("上游返回的模型列表为空")
	}
	return models, nil
}

// FetchChannelModels 已存渠道：用库里的 key/baseURL 打上游拉模型。
// GET /api/channel/:id/fetch_models
func FetchChannelModels(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	channel, err := model.GetChannelById(id, true) // selectAll=true 取 key
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "渠道不存在或读取失败：" + err.Error()})
		return
	}
	if !canAutoFetchModels(channel.Type) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该渠道类型暂不支持自动获取模型，请手动填写"})
		return
	}
	baseURL := ""
	if channel.BaseURL != nil {
		baseURL = *channel.BaseURL
	}
	models, err := fetchUpstreamModels(channel.Type, channel.Key, baseURL)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": models})
}

// fetchModelsByConfigRequest 未保存渠道（新建时无 id）的探测入参。
type fetchModelsByConfigRequest struct {
	Type    int    `json:"type"`
	Key     string `json:"key"`
	BaseURL string `json:"base_url"`
}

// FetchChannelModelsByConfig 未保存渠道：用前端表单当前的 type/key/base_url 探测。
// POST /api/channel/fetch_models
func FetchChannelModelsByConfig(c *gin.Context) {
	var req fetchModelsByConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if !canAutoFetchModels(req.Type) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该渠道类型暂不支持自动获取模型，请手动填写"})
		return
	}
	models, err := fetchUpstreamModels(req.Type, req.Key, req.BaseURL)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": models})
}

// 逐模型连通性探查（手动触发）
//
// /v1/models 返回的是平台全集，不按 key 过滤（百炼等尤其明显）。此接口对给定模型逐个
// 跑一次真实测试请求，返回每个模型的可用性，供用户筛掉调不通的。耗时且消耗 quota，
// 故仅在前端手动触发时调用，不自动执行。
type probeModelsRequest struct {
	Models []string `json:"models"`
}

type probeModelResult struct {
	Model string `json:"model"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// probeModelsConcurrency 限制并发，避免瞬间打爆上游或本机。
const probeModelsConcurrency = 5

// ProbeChannelModels 对已存渠道的一组模型逐个做连通性测试。
// POST /api/channel/:id/probe_models  body: {models: [...]}
func ProbeChannelModels(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	var req probeModelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	// 去重 + 过滤空值
	seen := make(map[string]struct{}, len(req.Models))
	models := make([]string, 0, len(req.Models))
	for _, m := range req.Models {
		m = strings.TrimSpace(m)
		if m == "" {
			continue
		}
		if _, ok := seen[m]; ok {
			continue
		}
		seen[m] = struct{}{}
		models = append(models, m)
	}
	if len(models) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "没有可探查的模型"})
		return
	}
	channel, err := model.GetChannelById(id, true) // selectAll=true 取 key
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "渠道不存在或读取失败：" + err.Error()})
		return
	}

	ctx := c.Request.Context()
	results := make([]probeModelResult, len(models))
	sem := make(chan struct{}, probeModelsConcurrency)
	var wg sync.WaitGroup
	for i, m := range models {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, modelName string) {
			defer wg.Done()
			defer func() { <-sem }()
			// testChannel 内有保护逻辑：待测 model 不在 channel.Models 里时会回退成
			// models[0]（见 channel-test.go）。探查的是「表单里刚拉回、尚未保存」的模型，
			// 多半不在库里的 channel.Models 中，若直接用会全部被替换成同一个模型而误判全过。
			// 故给每个 goroutine 一份 channel 副本，Models 设为当前待测模型，绕过回退。
			probeChannel := *channel
			probeChannel.Models = modelName
			testRequest := buildTestRequest(modelName)
			_, terr, _ := testChannel(ctx, &probeChannel, testRequest)
			res := probeModelResult{Model: modelName, OK: terr == nil}
			if terr != nil {
				res.Error = terr.Error()
			}
			results[idx] = res
		}(i, m)
	}
	wg.Wait()

	available := make([]string, 0, len(results))
	for _, r := range results {
		if r.OK {
			available = append(available, r.Model)
		}
	}
	sort.Strings(available)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"results":   results,
			"available": available,
			"total":     len(results),
			"ok_count":  len(available),
		},
	})
}
