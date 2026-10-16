package model

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func skillIconDataURL(t *testing.T, width, height int) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: uint8(x + y), A: 255})
		}
	}
	var output bytes.Buffer
	require.NoError(t, png.Encode(&output, img))
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
}

func TestNormalizeSkillIconRetainsGlyph(t *testing.T) {
	assert.Equal(t, "glyph:chart", NormalizeSkillIcon(" glyph:chart "))
	assert.Equal(t, "preset:assistant", NormalizeSkillIcon(" preset:assistant "))
}

func TestNormalizeSkillIconCompactsRasterWithoutChangingAspectRatio(t *testing.T) {
	original := skillIconDataURL(t, 512, 256)
	normalized := NormalizeSkillIcon(original)

	require.True(t, strings.HasPrefix(normalized, "data:image/png;base64,"))
	content, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(normalized, "data:image/png;base64,"))
	require.NoError(t, err)
	config, _, err := image.DecodeConfig(bytes.NewReader(content))
	require.NoError(t, err)
	assert.Equal(t, 96, config.Width)
	assert.Equal(t, 48, config.Height)
	assert.Less(t, len(normalized), len(original))
	assert.LessOrEqual(t, len(normalized), maxSkillIconDataURLBytes)
}

func TestNormalizeSkillIconRejectsMalformedRaster(t *testing.T) {
	assert.Equal(t, defaultSkillIcon, NormalizeSkillIcon("data:image/png;base64,not-base64"))
}
