package model

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func knowledgeCoverDataURL(t *testing.T, width, height int) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x), G: uint8(y), B: 40, A: 255})
		}
	}
	var output bytes.Buffer
	require.NoError(t, png.Encode(&output, img))
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
}

func TestNormalizeKnowledgeCoverStoresJPEG(t *testing.T) {
	normalized, err := NormalizeKnowledgeCover("  " + knowledgeCoverDataURL(t, 1200, 600) + " ")
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(normalized, "data:image/jpeg;base64,"))
	require.LessOrEqual(t, len(normalized), maxKnowledgeCoverStoredBytes)
	content, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(normalized, "data:image/jpeg;base64,"))
	require.NoError(t, err)
	config, _, err := image.DecodeConfig(bytes.NewReader(content))
	require.NoError(t, err)
	require.LessOrEqual(t, config.Width, 960)
	require.Equal(t, config.Width, config.Height*2)
}

func TestNormalizeKnowledgeCoverClearsBlank(t *testing.T) {
	normalized, err := NormalizeKnowledgeCover("  ")
	require.NoError(t, err)
	require.Empty(t, normalized)
}

func TestNormalizeKnowledgeCoverRejectsUnsupportedInput(t *testing.T) {
	_, err := NormalizeKnowledgeCover("https://example.test/cover.jpg")
	require.ErrorIs(t, err, ErrKnowledgeCoverInvalid)
	_, err = NormalizeKnowledgeCover("data:image/png;base64,not-base64")
	require.ErrorIs(t, err, ErrKnowledgeCoverInvalid)
	_, err = NormalizeKnowledgeCover("data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte("<svg/>")))
	require.ErrorIs(t, err, ErrKnowledgeCoverInvalid)
}
