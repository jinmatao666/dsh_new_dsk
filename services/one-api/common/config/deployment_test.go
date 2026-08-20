package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseDeploymentCapabilitiesDefaultsToAllDisabled(t *testing.T) {
	capabilities := parseDeploymentCapabilities("")

	assert.Len(t, capabilities, len(knownDeploymentCapabilities))
	for _, capability := range knownDeploymentCapabilities {
		assert.False(t, capabilities[capability], capability)
	}
}

func TestParseDeploymentCapabilitiesUsesKnownAllowlist(t *testing.T) {
	capabilities := parseDeploymentCapabilities(" remote_mcp,OCR, image_vision,unknown,ocr ")

	assert.True(t, capabilities[CapabilityRemoteMCP])
	assert.True(t, capabilities[CapabilityOCR])
	assert.True(t, capabilities[CapabilityImageVision])
	assert.False(t, capabilities[CapabilityWebSearch])
	_, containsUnknown := capabilities["unknown"]
	assert.False(t, containsUnknown)
}

func TestDeploymentModeDefaultsToPrivate(t *testing.T) {
	t.Setenv("PARVIS_DEPLOYMENT_MODE", "")
	assert.Equal(t, "private", DeploymentMode())

	t.Setenv("PARVIS_DEPLOYMENT_MODE", "public")
	assert.Equal(t, "public", DeploymentMode())

	t.Setenv("PARVIS_DEPLOYMENT_MODE", "unsupported")
	assert.Equal(t, "private", DeploymentMode())
}

func TestReleaseDetectionRequiresExplicitOptIn(t *testing.T) {
	t.Setenv("PARVIS_RELEASE_DETECTION_ENABLED", "")
	assert.False(t, ReleaseDetectionEnabled())

	t.Setenv("PARVIS_RELEASE_DETECTION_ENABLED", "false")
	assert.False(t, ReleaseDetectionEnabled())

	t.Setenv("PARVIS_RELEASE_DETECTION_ENABLED", "true")
	assert.True(t, ReleaseDetectionEnabled())
}
