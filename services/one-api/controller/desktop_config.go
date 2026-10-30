package controller

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
)

type desktopFeatureFlags struct {
	Automations    bool `json:"automations"`
	Connectors     bool `json:"connectors"`
	KnowledgeBases bool `json:"knowledgeBases"`
}

type desktopDeploymentSettings struct {
	InternetSkillPolicy   string                         `json:"internetSkillPolicy"`
	InternetExpertPolicy  string                         `json:"internetExpertPolicy"`
	InternetCatalogPolicy string                         `json:"internetCatalogPolicy"`
	Edition               string                         `json:"edition"`
	Network               string                         `json:"network"`
	Operator              string                         `json:"operator"`
	Phone                 string                         `json:"phone"`
	Features              map[string]desktopFeatureFlags `json:"features"`
	Plugins               desktopPluginSettings          `json:"plugins"`
	Resources             *desktopResourceSettings       `json:"resources,omitempty"`
	// KnowledgeQuota is workbench-only personal storage policy; desktop clients ignore it.
	KnowledgeQuota *knowledgePersonalQuotaSettings `json:"knowledgeQuota,omitempty"`
}

type desktopPluginSettings struct {
	BrowserAssistant bool `json:"browserAssistant"`
}

// Existing deployment records without feature settings retain their current behavior.
func parseDesktopDeploymentSettings(raw string) (desktopDeploymentSettings, error) {
	settings := desktopDeploymentSettings{InternetCatalogPolicy: "disable", InternetSkillPolicy: "disable", InternetExpertPolicy: "disable", Network: "internet", Edition: "operations", Plugins: desktopPluginSettings{BrowserAssistant: true}, Features: map[string]desktopFeatureFlags{
		"internet": {Automations: true, Connectors: true, KnowledgeBases: true},
		"intranet": {Automations: true, Connectors: false, KnowledgeBases: true},
	}}
	if raw == "" {
		return settings, nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		return settings, err
	}
	for _, key := range []string{"internetCatalogPolicy", "internetSkillPolicy", "internetExpertPolicy"} {
		if field, present := fields[key]; present {
			var policy interface{}
			if err := json.Unmarshal(field, &policy); err != nil || (policy != "hide" && policy != "disable") {
				return settings, fmt.Errorf("invalid %s", key)
			}
		}
	}
	var mode interface{}
	if err := json.Unmarshal(fields["network"], &mode); err != nil {
		return settings, err
	}
	if mode != "internet" && mode != "intranet" {
		return settings, fmt.Errorf("invalid network")
	}
	if field, present := fields["edition"]; present {
		var edition interface{}
		if err := json.Unmarshal(field, &edition); err != nil {
			return settings, err
		}
		if edition != "government" && edition != "operations" {
			return settings, fmt.Errorf("invalid edition")
		}
	}
	for _, key := range []string{"operator", "phone"} {
		if field, present := fields[key]; present {
			var value interface{}
			if err := json.Unmarshal(field, &value); err != nil {
				return settings, err
			}
			if _, ok := value.(string); !ok {
				return settings, fmt.Errorf("invalid contact: %s", key)
			}
		}
	}
	legacyKnowledge := make(map[string]bool)
	if features, present := fields["features"]; present {
		var environments map[string]map[string]interface{}
		if err := json.Unmarshal(features, &environments); err != nil {
			return settings, err
		}
		for _, mode := range []string{"internet", "intranet"} {
			for _, feature := range []string{"automations", "connectors", "knowledgeBases"} {
				if _, present := environments[mode][feature]; feature == "knowledgeBases" && !present {
					legacyKnowledge[mode] = true
					continue
				}
				if _, ok := environments[mode][feature].(bool); !ok {
					return settings, fmt.Errorf("invalid feature setting: %s.%s", mode, feature)
				}
			}
		}
	}
	if plugins, present := fields["plugins"]; present {
		var flags map[string]interface{}
		if err := json.Unmarshal(plugins, &flags); err != nil {
			return settings, err
		}
		if _, ok := flags["browserAssistant"].(bool); !ok {
			return settings, fmt.Errorf("invalid plugin setting: browserAssistant")
		}
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return settings, err
	}
	if field, present := fields["knowledgeQuota"]; present {
		quota, err := parseKnowledgePersonalQuota(field)
		if err != nil {
			return settings, err
		}
		settings.KnowledgeQuota = &quota
	}
	if settings.InternetCatalogPolicy != "hide" && settings.InternetCatalogPolicy != "disable" {
		return settings, fmt.Errorf("invalid internetCatalogPolicy")
	}
	// 缺少独立策略的旧记录沿用原来的统一策略，显式设置保持独立。
	if _, present := fields["internetSkillPolicy"]; !present {
		settings.InternetSkillPolicy = settings.InternetCatalogPolicy
	}
	if _, present := fields["internetExpertPolicy"]; !present {
		settings.InternetExpertPolicy = settings.InternetCatalogPolicy
	}
	// 旧记录只补新增字段，不覆盖已有的功能开关。
	for mode := range legacyKnowledge {
		flags := settings.Features[mode]
		flags.KnowledgeBases = true
		settings.Features[mode] = flags
	}
	if field, present := fields["resources"]; present {
		var resourceFields map[string]interface{}
		if err := json.Unmarshal(field, &resourceFields); err != nil {
			return settings, err
		}
		if _, ok := resourceFields["autoDetect"].(bool); !ok {
			return settings, fmt.Errorf("invalid resources.autoDetect")
		}
		if _, ok := resourceFields["proxyUrl"].(string); !ok {
			return settings, fmt.Errorf("invalid resources.proxyUrl")
		}
		if _, ok := resourceFields["probeUrls"].([]interface{}); !ok {
			return settings, fmt.Errorf("invalid resources.probeUrls")
		}
	}
	if settings.Resources != nil {
		if err := validateDesktopResources(*settings.Resources); err != nil {
			return settings, err
		}
	}
	settings.Features = map[string]desktopFeatureFlags{"internet": settings.Features["internet"], "intranet": settings.Features["intranet"]}
	if settings.Network != "internet" && settings.Network != "intranet" {
		return settings, fmt.Errorf("invalid network")
	}
	return settings, nil
}

// GetDesktopConfig exposes deployment mode, entry visibility and the support contact before login.
func GetDesktopConfig(c *gin.Context) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	settings, err := parseDesktopDeploymentSettings(raw)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "系统部署配置无效，请联系管理员"})
		return
	}
	// Personal quota is workbench admin policy; do not publish it on the pre-login desktop surface.
	settings.KnowledgeQuota = nil
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": settings})
}
