package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/service/ragflow"
)

// knowledgePersonalQuotaSettings limits total and per-user personal knowledge storage.
type knowledgePersonalQuotaSettings struct {
	Enabled     bool                                `json:"enabled"`
	TotalBytes  int64                               `json:"totalBytes"`
	Allocations []knowledgePersonalQuotaAllocation  `json:"allocations"`
}

type knowledgePersonalQuotaAllocation struct {
	UserId     int   `json:"userId"`
	QuotaBytes int64 `json:"quotaBytes"`
}

func defaultKnowledgePersonalQuota() knowledgePersonalQuotaSettings {
	return knowledgePersonalQuotaSettings{Enabled: false, TotalBytes: 0, Allocations: []knowledgePersonalQuotaAllocation{}}
}

// parseKnowledgePersonalQuota validates optional knowledgeQuota in deployment settings.
// Missing or null values keep the default (switch off). Enabled configs require a positive total.
func parseKnowledgePersonalQuota(raw json.RawMessage) (knowledgePersonalQuotaSettings, error) {
	settings := defaultKnowledgePersonalQuota()
	if len(raw) == 0 || string(raw) == "null" {
		return settings, nil
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return settings, fmt.Errorf("invalid knowledgeQuota")
	}
	if settings.Allocations == nil {
		settings.Allocations = []knowledgePersonalQuotaAllocation{}
	}
	if !settings.Enabled {
		if settings.TotalBytes < 0 {
			return settings, fmt.Errorf("invalid knowledgeQuota.totalBytes")
		}
		seen := make(map[int]struct{}, len(settings.Allocations))
		for _, allocation := range settings.Allocations {
			if allocation.UserId <= 0 || allocation.QuotaBytes <= 0 {
				return settings, fmt.Errorf("invalid knowledgeQuota.allocations")
			}
			if _, exists := seen[allocation.UserId]; exists {
				return settings, fmt.Errorf("duplicate knowledgeQuota allocation")
			}
			seen[allocation.UserId] = struct{}{}
		}
		return settings, nil
	}
	if settings.TotalBytes <= 0 {
		return settings, fmt.Errorf("knowledgeQuota.totalBytes required when enabled")
	}
	var allocated int64
	seen := make(map[int]struct{}, len(settings.Allocations))
	for _, allocation := range settings.Allocations {
		if allocation.UserId <= 0 || allocation.QuotaBytes <= 0 {
			return settings, fmt.Errorf("invalid knowledgeQuota.allocations")
		}
		if _, exists := seen[allocation.UserId]; exists {
			return settings, fmt.Errorf("duplicate knowledgeQuota allocation")
		}
		seen[allocation.UserId] = struct{}{}
		allocated += allocation.QuotaBytes
		if allocated < 0 || allocated > settings.TotalBytes {
			return settings, fmt.Errorf("knowledgeQuota allocations exceed total")
		}
	}
	return settings, nil
}

func loadKnowledgePersonalQuota() (knowledgePersonalQuotaSettings, error) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	if raw == "" {
		return defaultKnowledgePersonalQuota(), nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return defaultKnowledgePersonalQuota(), err
	}
	return parseKnowledgePersonalQuota(fields["knowledgeQuota"])
}

func formatKnowledgeQuotaBytes(bytes int64) string {
	if bytes < 0 {
		bytes = 0
	}
	const megabyte = int64(1 << 20)
	if bytes%megabyte == 0 {
		return fmt.Sprintf("%dMB", bytes/megabyte)
	}
	return fmt.Sprintf("%.1fMB", float64(bytes)/float64(megabyte))
}

func personalDatasetBytes(ctx context.Context, client *ragflow.Client, bases []model.KnowledgeBase) (int64, error) {
	if client == nil || len(bases) == 0 {
		return 0, nil
	}
	var (
		total int64
		mu    sync.Mutex
		wg    sync.WaitGroup
	)
	sem := make(chan struct{}, 4)
	for i := range bases {
		datasetId := bases[i].RagflowDatasetId
		if datasetId == "" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(datasetId string) {
			defer wg.Done()
			defer func() { <-sem }()
			_, bytes := plazaDatasetStats(ctx, client, datasetId)
			mu.Lock()
			total += bytes
			mu.Unlock()
		}(datasetId)
	}
	wg.Wait()
	return total, nil
}

func ownerQuotaBytes(settings knowledgePersonalQuotaSettings, ownerUserId int) (int64, bool) {
	for _, allocation := range settings.Allocations {
		if allocation.UserId == ownerUserId {
			return allocation.QuotaBytes, true
		}
	}
	return 0, false
}

// enforcePersonalKnowledgeQuota rejects uploads that would exceed the configured personal storage limit.
// Non-personal libraries and a disabled switch pass through. Returns false when the handler already wrote a response.
func enforcePersonalKnowledgeQuota(c *gin.Context, row *model.KnowledgeBase, uploadBytes int64) bool {
	if row == nil || row.Kind != model.KnowledgeBasePersonal {
		return true
	}
	if uploadBytes < 0 {
		uploadBytes = 0
	}
	settings, err := loadKnowledgePersonalQuota()
	if err != nil {
		logger.Errorf(c.Request.Context(), "load knowledge quota: %s", err.Error())
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "暂时无法校验个人知识库容量，请稍后重试"})
		return false
	}
	if !settings.Enabled {
		return true
	}
	if settings.TotalBytes <= 0 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "个人知识库容量限制配置无效，请联系管理员"})
		return false
	}
	client, err := ragflow.NewFromEnvironment()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "暂时无法校验个人知识库容量，请稍后重试"})
		return false
	}
	allPersonal, err := model.ListPersonalKnowledgeBases()
	if err != nil {
		logger.Errorf(c.Request.Context(), "list personal knowledge bases: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "暂时无法校验个人知识库容量，请稍后重试"})
		return false
	}
	totalUsed, err := personalDatasetBytes(c.Request.Context(), client, allPersonal)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "暂时无法校验个人知识库容量，请稍后重试"})
		return false
	}
	if totalUsed+uploadBytes > settings.TotalBytes {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": fmt.Sprintf("个人知识库总容量已达上限（%s），无法继续上传。请删除部分文件或联系管理员扩大容量。", formatKnowledgeQuotaBytes(settings.TotalBytes)),
		})
		return false
	}
	quota, allocated := ownerQuotaBytes(settings, row.OwnerUserId)
	if !allocated {
		return true
	}
	ownerBases, err := model.ListPersonalKnowledgeBasesByOwner(row.OwnerUserId)
	if err != nil {
		logger.Errorf(c.Request.Context(), "list owner personal knowledge bases: %s", err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "暂时无法校验个人知识库容量，请稍后重试"})
		return false
	}
	ownerUsed, err := personalDatasetBytes(c.Request.Context(), client, ownerBases)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "暂时无法校验个人知识库容量，请稍后重试"})
		return false
	}
	if ownerUsed+uploadBytes > quota {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": fmt.Sprintf("您的个人知识库容量已达上限（%s），无法继续上传。请删除部分文件或联系管理员。", formatKnowledgeQuotaBytes(quota)),
		})
		return false
	}
	return true
}
