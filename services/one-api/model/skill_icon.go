package model

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	defaultSkillIcon         = "glyph:bot"
	maxSkillIconInputChars   = 3 << 20
	maxSkillIconDataURLBytes = 48 << 10
	maxSkillIconDimension    = 96
	maxSkillIconSourcePixels = 16_000_000
)

var skillIconGlyphs = map[string]struct{}{
	"glyph:map":       {},
	"glyph:document":  {},
	"glyph:chart":     {},
	"glyph:compass":   {},
	"glyph:bot":       {},
	"glyph:lightning": {},
}

// NormalizeSkillIcon retains built-in glyphs and converts raster data URLs to
// compact PNG thumbnails suitable for inclusion in the skill-list response.
func NormalizeSkillIcon(raw string) string {
	icon := strings.TrimSpace(raw)
	if icon == "" {
		return defaultSkillIcon
	}
	if _, ok := skillIconGlyphs[icon]; ok {
		return icon
	}
	if len(icon) > maxSkillIconInputChars {
		return defaultSkillIcon
	}

	separator := strings.Index(icon, ",")
	if separator < 0 {
		return defaultSkillIcon
	}
	prefix := strings.ToLower(icon[:separator+1])
	if prefix != "data:image/png;base64," &&
		prefix != "data:image/jpeg;base64," &&
		prefix != "data:image/webp;base64," &&
		prefix != "data:image/gif;base64," {
		return defaultSkillIcon
	}
	encoded := icon[separator+1:]
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return defaultSkillIcon
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || config.Width < 1 || config.Height < 1 ||
		config.Width > maxSkillIconSourcePixels/config.Height {
		return defaultSkillIcon
	}
	if config.Width <= maxSkillIconDimension && config.Height <= maxSkillIconDimension && len(icon) <= maxSkillIconDataURLBytes {
		return icon
	}

	source, _, err := image.Decode(bytes.NewReader(content))
	if err != nil {
		return defaultSkillIcon
	}
	for _, bound := range []int{96, 80, 64, 48, 40, 32} {
		width, height := boundedSkillIconSize(config.Width, config.Height, bound)
		thumbnail := image.NewNRGBA(image.Rect(0, 0, width, height))
		draw.CatmullRom.Scale(thumbnail, thumbnail.Bounds(), source, source.Bounds(), draw.Over, nil)
		var output bytes.Buffer
		encoder := png.Encoder{CompressionLevel: png.BestCompression}
		if err := encoder.Encode(&output, thumbnail); err != nil {
			return defaultSkillIcon
		}
		dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(output.Bytes())
		if len(dataURL) <= maxSkillIconDataURLBytes || bound == 32 {
			return dataURL
		}
	}
	return defaultSkillIcon
}

func boundedSkillIconSize(width, height, bound int) (int, int) {
	if width <= bound && height <= bound {
		return width, height
	}
	if width >= height {
		return bound, skillIconPositiveSize(height * bound / width)
	}
	return skillIconPositiveSize(width * bound / height), bound
}

func skillIconPositiveSize(value int) int {
	if value < 1 {
		return 1
	}
	return value
}

// MigrateSkillIcons compacts existing raster icons without changing skill
// metadata timestamps. It is idempotent and runs before the skill cache loads.
func MigrateSkillIcons() (int, error) {
	var skills []Skill
	if err := DB.Select("id", "icon").Where("icon LIKE ?", "data:image/%").Find(&skills).Error; err != nil {
		return 0, err
	}
	updated := 0
	for _, skill := range skills {
		normalized := NormalizeSkillIcon(skill.Icon)
		if normalized == skill.Icon {
			continue
		}
		if err := DB.Model(&Skill{}).Where("id = ?", skill.Id).UpdateColumn("icon", normalized).Error; err != nil {
			return updated, err
		}
		updated++
	}
	return updated, nil
}
