package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const (
	DeploymentConfigSchemaVersion = 1

	CapabilityRemoteMCP       = "remote_mcp"
	CapabilityWebSearch       = "web_search"
	CapabilityImageSearch     = "image_search"
	CapabilityImageGeneration = "image_generation"
	CapabilityImageVision     = "image_vision"
	CapabilityOCR             = "ocr"
	CapabilitySpeechToText    = "speech_to_text"
	CapabilityRemoteSkills    = "remote_skills"
	CapabilityGIS             = "gis"
)

var knownDeploymentCapabilities = []string{
	CapabilityRemoteMCP,
	CapabilityWebSearch,
	CapabilityImageSearch,
	CapabilityImageGeneration,
	CapabilityImageVision,
	CapabilityOCR,
	CapabilitySpeechToText,
	CapabilityRemoteSkills,
	CapabilityGIS,
}

// DeploymentMode identifies the server deployment contract exposed to clients.
// Private is the fail-closed default so an incomplete deployment never silently
// falls back to public services.
func DeploymentMode() string {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("PARVIS_DEPLOYMENT_MODE"))) {
	case "public":
		return "public"
	case "private":
		return "private"
	default:
		return "private"
	}
}

// DeploymentCapabilities returns every stable capability name with an explicit
// boolean value. PARVIS_CAPABILITIES is a comma-separated allowlist; missing and
// unknown values do not enable anything.
func DeploymentCapabilities() map[string]bool {
	return parseDeploymentCapabilities(os.Getenv("PARVIS_CAPABILITIES"))
}

func parseDeploymentCapabilities(raw string) map[string]bool {
	capabilities := make(map[string]bool, len(knownDeploymentCapabilities))
	for _, capability := range knownDeploymentCapabilities {
		capabilities[capability] = false
	}

	known := make(map[string]struct{}, len(knownDeploymentCapabilities))
	for _, capability := range knownDeploymentCapabilities {
		known[capability] = struct{}{}
	}
	for _, item := range strings.Split(raw, ",") {
		capability := strings.ToLower(strings.TrimSpace(item))
		if _, ok := known[capability]; ok {
			capabilities[capability] = true
		}
	}
	return capabilities
}

// ReleaseDetectionEnabled is deliberately opt-in because the retained detector
// contacts public release, website, and backend endpoints.
func ReleaseDetectionEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("PARVIS_RELEASE_DETECTION_ENABLED")), "true")
}

// CreditPolicy separates visibility from accounting; absent flags follow the edition.
type CreditPolicy struct {
	ShowCredits     bool `json:"showCredits"`
	ShowMultipliers bool `json:"showMultipliers"`
	Enabled         bool `json:"enabled"`
}

func ResolveCreditPolicy(raw string) (CreditPolicy, error) {
	var settings struct {
		Edition string          `json:"edition"`
		Billing json.RawMessage `json:"billing"`
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil && raw != "" {
		return CreditPolicy{}, err
	}
	var flags map[string]json.RawMessage
	if settings.Billing != nil {
		if strings.TrimSpace(string(settings.Billing)) == "null" {
			return CreditPolicy{}, fmt.Errorf("invalid billing")
		}
		if err := json.Unmarshal(settings.Billing, &flags); err != nil {
			return CreditPolicy{}, err
		}
	}
	enabled := settings.Edition != "government"
	policy := CreditPolicy{enabled, enabled, enabled}
	for key, target := range map[string]*bool{
		"showCredits": &policy.ShowCredits, "showMultipliers": &policy.ShowMultipliers, "enabled": &policy.Enabled,
	} {
		if value, ok := flags[key]; ok {
			if string(value) == "null" {
				return policy, fmt.Errorf("invalid billing.%s", key)
			}
			if err := json.Unmarshal(value, target); err != nil {
				return policy, err
			}
		}
	}
	return policy, nil
}

// CreditsDisabled reads the edition policy without changing balances or prices.
func CreditsDisabled() bool {
	OptionMapRWMutex.RLock()
	raw := OptionMap["SystemDeploymentSettings"]
	OptionMapRWMutex.RUnlock()
	policy, err := ResolveCreditPolicy(raw)
	return err == nil && !policy.Enabled
}
