package model

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxKnowledgeCoverInputChars   = 8 << 20
	maxKnowledgeCoverStoredBytes  = 60 << 10
	maxKnowledgeCoverSourcePixels = 16_000_000
)

// ErrKnowledgeCoverInvalid is returned when a cover is not a supported raster image
// or cannot be reduced to the stored size.
var ErrKnowledgeCoverInvalid = errors.New("封面图片无效")

// NormalizeKnowledgeCover accepts an empty value or a PNG, JPEG, WebP, or GIF data URL
// and returns a JPEG data URL that fits in knowledge_bases.cover.
// An empty input returns an empty string so create and edit can clear the plaza photo.
func NormalizeKnowledgeCover(raw string) (string, error) {
	cover := strings.TrimSpace(raw)
	if cover == "" {
		return "", nil
	}
	if len(cover) > maxKnowledgeCoverInputChars {
		return "", ErrKnowledgeCoverInvalid
	}
	separator := strings.Index(cover, ",")
	if separator < 0 {
		return "", ErrKnowledgeCoverInvalid
	}
	prefix := strings.ToLower(cover[:separator+1])
	switch prefix {
	case "data:image/png;base64,", "data:image/jpeg;base64,", "data:image/jpg;base64,",
		"data:image/webp;base64,", "data:image/gif;base64,":
	default:
		return "", ErrKnowledgeCoverInvalid
	}
	content, err := base64.StdEncoding.DecodeString(cover[separator+1:])
	if err != nil {
		return "", ErrKnowledgeCoverInvalid
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > maxKnowledgeCoverSourcePixels/config.Height {
		return "", ErrKnowledgeCoverInvalid
	}
	source, _, err := image.Decode(bytes.NewReader(content))
	if err != nil {
		return "", ErrKnowledgeCoverInvalid
	}
	for _, edge := range []int{960, 720, 480, 360} {
		width, height := boundedKnowledgeCoverSize(config.Width, config.Height, edge)
		thumbnail := image.NewNRGBA(image.Rect(0, 0, width, height))
		draw.CatmullRom.Scale(thumbnail, thumbnail.Bounds(), source, source.Bounds(), draw.Over, nil)
		for _, quality := range []int{80, 60, 45} {
			var output bytes.Buffer
			if err := jpeg.Encode(&output, thumbnail, &jpeg.Options{Quality: quality}); err != nil {
				return "", ErrKnowledgeCoverInvalid
			}
			dataURL := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
			if len(dataURL) <= maxKnowledgeCoverStoredBytes {
				return dataURL, nil
			}
		}
	}
	return "", ErrKnowledgeCoverInvalid
}

func boundedKnowledgeCoverSize(width, height, edge int) (int, int) {
	if width <= edge && height <= edge {
		return width, height
	}
	if width >= height {
		return edge, knowledgeCoverPositive(height * edge / width)
	}
	return knowledgeCoverPositive(width * edge / height), edge
}

func knowledgeCoverPositive(value int) int {
	if value < 1 {
		return 1
	}
	return value
}
