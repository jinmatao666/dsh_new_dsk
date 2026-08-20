package model

import (
	"strings"
	"sync"
	"time"

	"github.com/songquanpeng/one-api/common/logger"
)

// 显式缓存支持模型集合的内存缓存。
//
// 背景：显式 prompt cache（阿里云百炼 qwen/glm 等）此前靠客户端硬编码白名单，
// 每次新增模型都要改代码发版。改为后台 ModelDefinition.SupportExplicitCache 勾选，
// 网关据此在转发请求时注入 content 块级 cache_control 锚点。
//
// 该集合在热路径（每次 relay）被读取，故用内存缓存 + 定时刷新，避免每请求查库。
// 模型名统一小写存储，查询时也小写，规避大小写不一致。
var (
	explicitCacheModelsLock sync.RWMutex
	explicitCacheModels     = make(map[string]bool)
)

// InitExplicitCacheModelCache 从 ModelDefinition 表加载所有勾选了"显式缓存"的模型名到内存。
func InitExplicitCacheModelCache() {
	defs, err := GetAllModelDefinitions()
	if err != nil {
		logger.SysError("failed to load model definitions for explicit cache: " + err.Error())
		return
	}
	next := make(map[string]bool)
	for _, def := range defs {
		if def.SupportExplicitCache {
			next[strings.ToLower(def.Name)] = true
		}
	}
	explicitCacheModelsLock.Lock()
	explicitCacheModels = next
	explicitCacheModelsLock.Unlock()
	logger.SysLog("explicit cache models synced from database")
}

// SyncExplicitCacheModelCache 定时刷新显式缓存模型集合。
func SyncExplicitCacheModelCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		InitExplicitCacheModelCache()
	}
}

// ModelSupportsExplicitCache 判断某模型是否勾选了显式缓存（热路径调用，读内存）。
func ModelSupportsExplicitCache(modelName string) bool {
	if modelName == "" {
		return false
	}
	explicitCacheModelsLock.RLock()
	defer explicitCacheModelsLock.RUnlock()
	return explicitCacheModels[strings.ToLower(modelName)]
}
