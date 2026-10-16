package config

import (
	"encoding/json"
	"strings"
)

// ModelContextLimits2JSONString 序列化为 JSON 字符串
func ModelContextLimits2JSONString() string {
	ModelContextLimitsRWMutex.RLock()
	defer ModelContextLimitsRWMutex.RUnlock()
	jsonBytes, _ := json.Marshal(ModelContextLimits)
	return string(jsonBytes)
}

// UpdateModelContextLimitsByJSONString 从 JSON 字符串更新配置，线程安全
func UpdateModelContextLimitsByJSONString(jsonStr string) error {
	ModelContextLimitsRWMutex.Lock()
	defer ModelContextLimitsRWMutex.Unlock()
	ModelContextLimits = make(map[string]int)
	return json.Unmarshal([]byte(jsonStr), &ModelContextLimits)
}

// GetModelContextLimit 根据模型名称获取 context limit
// 匹配规则：模型名包含 key（不区分大小写）即命中，未命中返回 DefaultContextLimit
func GetModelContextLimit(modelName string) int {
	ModelContextLimitsRWMutex.RLock()
	defer ModelContextLimitsRWMutex.RUnlock()
	lowerModel := strings.ToLower(modelName)
	for key, limit := range ModelContextLimits {
		if strings.Contains(lowerModel, strings.ToLower(key)) {
			return limit
		}
	}
	return DefaultContextLimit
}
