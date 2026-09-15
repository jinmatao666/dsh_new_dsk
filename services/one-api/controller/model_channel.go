package controller

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

const visionProbeImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="

func buildVisionProbeRequest(modelName string) *relaymodel.GeneralOpenAIRequest {
	return &relaymodel.GeneralOpenAIRequest{
		Model: modelName,
		Messages: []relaymodel.Message{{
			Role: "user",
			Content: []any{
				map[string]any{"type": "text", "text": "Name the dominant color in this image using one word."},
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": visionProbeImage}},
			},
		}},
		MaxTokens: 16,
	}
}

func isExplicitImageUnsupported(message string) bool {
	message = strings.ToLower(message)
	markers := []string{
		"image input is not supported", "does not support image", "doesn't support image",
		"image_url is not supported", "unsupported image", "vision is not supported",
		"不支持图片", "不支持图像", "不支持视觉", "不支持多模态",
	}
	for _, marker := range markers {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

// 模型↔渠道关系接口(T1.3)
// ability 表是「模型挂渠道」的唯一权威,以下接口供模型配置页维护某模型的渠道来源。

// GetModelChannelSources 查某模型的全部渠道来源
// GET /api/model_definition/:id/sources
func GetModelChannelSources(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondError(c, err.Error())
		return
	}
	def, err := model.GetModelDefinitionById(id)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	sources, err := model.GetModelChannelSources(def.Name)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    sources,
	})
}

type modelSourceRequest struct {
	Model     string `json:"model"`
	ChannelId int    `json:"channel_id"`
	Group     string `json:"group"`
	Priority  *int64 `json:"priority"`
}

// AddModelChannelSource 给模型新增一个渠道来源
// POST /api/model_definition/source
func AddModelChannelSource(c *gin.Context) {
	var req modelSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, err.Error())
		return
	}
	if err := model.AddModelChannelSource(req.Model, req.ChannelId, req.Group, req.Priority); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// DeleteModelChannelSource 删除模型的一个渠道来源
// DELETE /api/model_definition/source
func DeleteModelChannelSource(c *gin.Context) {
	var req modelSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, err.Error())
		return
	}
	if err := model.DeleteModelChannelSource(req.Model, req.ChannelId, req.Group); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// GetCandidateChannels 按模型名查支持它的渠道(渠道 models 字段包含该名),供新增模型时选择来源。
func GetCandidateChannels(c *gin.Context) {
	name := c.Query("model")
	chs, err := model.GetChannelsSupportingModel(name)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": chs})
}

// GetChannelModelNames 汇总所有渠道 models 字段里的去重模型名,供新增模型时搜索选择。
// GET /api/model_definition/channel_model_names
func GetChannelModelNames(c *gin.Context) {
	names, err := model.GetAllChannelModelNames()
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": names})
}

// SetModelChannelSourcePriority 设置模型某来源优先级
// PUT /api/model_definition/source/priority
func SetModelChannelSourcePriority(c *gin.Context) {
	var req modelSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, err.Error())
		return
	}
	if req.Priority == nil {
		respondError(c, "缺少 priority")
		return
	}
	if err := model.SetModelChannelSourcePriority(req.Model, req.ChannelId, req.Group, *req.Priority); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// modelSourceTestResult 单个来源的连通性测试结果
type modelSourceTestResult struct {
	ChannelId   int     `json:"channel_id"`
	ChannelName string  `json:"channel_name"`
	Success     bool    `json:"success"`
	Message     string  `json:"message"`
	Time        float64 `json:"time"` // 秒
}

// TestModelChannels 测试某模型在其所有来源渠道下的连通性(T1.7)。
// 复用 testChannel(channel, model) 二元测试,逐来源执行。
// GET /api/model_definition/:id/test  或  GET /api/model_definition/test?model=xxx
func TestModelChannels(c *gin.Context) {
	ctx := c.Request.Context()
	modelName := c.Query("model")
	if modelName == "" {
		// 兼容按 id 调用:解析 ModelDefinition 取其 Name
		if idStr := c.Param("id"); idStr != "" {
			id, err := strconv.Atoi(idStr)
			if err != nil {
				respondError(c, err.Error())
				return
			}
			def, err := model.GetModelDefinitionById(id)
			if err != nil {
				respondError(c, err.Error())
				return
			}
			modelName = def.Name
		}
	}
	if modelName == "" {
		respondError(c, "缺少模型名")
		return
	}

	sources, err := model.GetModelChannelSources(modelName)
	if err != nil {
		respondError(c, err.Error())
		return
	}

	results := make([]modelSourceTestResult, 0, len(sources))
	for _, s := range sources {
		channel, err := model.GetChannelById(s.ChannelId, true)
		if err != nil {
			results = append(results, modelSourceTestResult{
				ChannelId: s.ChannelId, ChannelName: s.ChannelName,
				Success: false, Message: "渠道不存在",
			})
			continue
		}
		testRequest := buildTestRequest(modelName)
		tik := time.Now()
		responseMessage, err, _ := testChannel(ctx, channel, testRequest)
		milliseconds := time.Since(tik).Milliseconds()
		r := modelSourceTestResult{
			ChannelId: s.ChannelId, ChannelName: s.ChannelName,
		}
		if err != nil {
			r.Success = false
			r.Message = err.Error()
			r.Time = 0
		} else {
			r.Success = true
			r.Message = responseMessage
			r.Time = float64(milliseconds) / 1000.0
			go channel.UpdateResponseTime(milliseconds)
		}
		results = append(results, r)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    results,
	})
}

// DetectModelVisionCapability probes the model with a small built-in image and
// stores the result in the existing desktop synchronization fields.
func DetectModelVisionCapability(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		respondError(c, err.Error())
		return
	}
	def, err := model.GetModelDefinitionById(id)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	sources, err := model.GetModelChannelSources(def.Name)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	if len(sources) == 0 {
		respondError(c, "模型尚未绑定来源渠道，无法检测视觉能力")
		return
	}

	var failures []string
	explicitlyUnsupported := false
	for _, source := range sources {
		if !source.Enabled || source.Status != model.ChannelStatusEnabled {
			continue
		}
		channel, channelErr := model.GetChannelById(source.ChannelId, true)
		if channelErr != nil {
			failures = append(failures, source.ChannelName+": 渠道不存在")
			continue
		}
		response, probeErr, _ := testChannel(c.Request.Context(), channel, buildVisionProbeRequest(def.Name))
		if probeErr == nil {
			answer := strings.ToLower(strings.TrimSpace(response))
			if strings.Contains(answer, "red") || strings.Contains(answer, "红") {
				if err := model.UpdateModelDefinitionVisionCapability(def.Id, true); err != nil {
					respondError(c, err.Error())
					return
				}
				c.JSON(http.StatusOK, gin.H{
					"success": true,
					"message": "已识别为视觉模型",
					"data":    gin.H{"status": "vision", "supports_image": true},
				})
				return
			}
			failures = append(failures, source.ChannelName+": 模型未正确识别测试图片")
			continue
		}
		if isExplicitImageUnsupported(probeErr.Error()) {
			explicitlyUnsupported = true
		}
		failures = append(failures, source.ChannelName+": "+probeErr.Error())
	}

	if explicitlyUnsupported {
		if err := model.UpdateModelDefinitionVisionCapability(def.Id, false); err != nil {
			respondError(c, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "已识别为纯文本模型",
			"data":    gin.H{"status": "text", "supports_image": false},
		})
		return
	}
	if len(failures) == 0 {
		failures = append(failures, "没有已启用的来源渠道")
	}
	respondError(c, "视觉能力检测失败："+strings.Join(failures, "；"))
}
