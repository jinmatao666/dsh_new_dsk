package config

import (
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
