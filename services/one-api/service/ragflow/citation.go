package ragflow

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var (
	// ##i$$ and [ID:i] both address the 0-based RAGFlow reference chunk index.
	citationMarker = regexp.MustCompile(`(?i)##(\d+)\$\$|\[ID:(\d+)\]`)
	pageInContent  = regexp.MustCompile(`第\s*(\d+)\s*页`)
)

// CitationPosition is one RAGFlow chunk box in PDF absolute coordinates (or 0–1).
type CitationPosition struct {
	Page   int     `json:"page"`
	Left   float64 `json:"left"`
	Right  float64 `json:"right"`
	Top    float64 `json:"top"`
	Bottom float64 `json:"bottom"`
}

// Citation is one desktop-locatable answer source derived from RAGFlow reference chunks.
type Citation struct {
	Index        int                `json:"index"`
	ChunkIndex   int                `json:"chunk_index"`
	DocumentId   string             `json:"document_id"`
	DocumentName string             `json:"document_name"`
	Page         *int               `json:"page,omitempty"`
	Quote        string             `json:"quote"`
	ChunkId      string             `json:"chunk_id,omitempty"`
	Positions    []CitationPosition `json:"positions,omitempty"`
}

type ragflowReference struct {
	Chunks []ragflowRefChunk `json:"chunks"`
}

type ragflowRefChunk struct {
	Id           string          `json:"id"`
	Content      string          `json:"content"`
	DocumentId   string          `json:"document_id"`
	DocumentName string          `json:"document_name"`
	DocId        string          `json:"doc_id"`
	DocName      string          `json:"doc_name"`
	Page         json.RawMessage `json:"page"`
	Positions    json.RawMessage `json:"positions"`
	PositionInt  json.RawMessage `json:"position_int"`
}

// ParseCitations maps RAGFlow completion.reference chunks into desktop citation rows.
// Index is 1-based for UI; ChunkIndex matches ##i$$ / [ID:i] markers in the answer.
// Answers without markers return no citations so the desktop does not invent sources.
func ParseCitations(reference json.RawMessage, answer string) []Citation {
	trimmedAnswer := strings.TrimSpace(answer)
	if trimmedAnswer == "" || strings.Contains(trimmedAnswer, "知识库中未找到相关内容") {
		return []Citation{}
	}
	chunks := parseReferenceChunks(reference)
	if len(chunks) == 0 {
		return []Citation{}
	}
	used := citedChunkIndexes(answer, len(chunks))
	if len(used) == 0 {
		return []Citation{}
	}
	out := make([]Citation, 0, len(used))
	for _, chunkIndex := range used {
		if chunkIndex < 0 || chunkIndex >= len(chunks) {
			continue
		}
		chunk := chunks[chunkIndex]
		documentId := firstNonEmpty(chunk.DocumentId, chunk.DocId)
		documentName := firstNonEmpty(chunk.DocumentName, chunk.DocName)
		if documentId == "" && documentName == "" {
			continue
		}
		positions := parsePositions(chunk.Positions)
		if len(positions) == 0 {
			positions = parsePositions(chunk.PositionInt)
		}
		page, hasPage := pageFromPositions(positions)
		if !hasPage {
			page = pageFromRaw(chunk.Page)
			hasPage = page > 0
		}
		if !hasPage {
			page = pageFromText(chunk.Content)
			hasPage = page > 0
		}
		quote := strings.TrimSpace(chunk.Content)
		if utf8.RuneCountInString(quote) > 240 {
			quote = string([]rune(quote)[:240])
		}
		citation := Citation{
			Index:        len(out) + 1,
			ChunkIndex:   chunkIndex,
			DocumentId:   documentId,
			DocumentName: documentName,
			Quote:        quote,
			ChunkId:      chunk.Id,
			Positions:    positions,
		}
		if hasPage {
			citation.Page = &page
		}
		out = append(out, citation)
	}
	return out
}

func parseReferenceChunks(reference json.RawMessage) []ragflowRefChunk {
	trimmed := strings.TrimSpace(string(reference))
	if trimmed == "" || trimmed == "null" || trimmed == "{}" {
		return nil
	}
	var wrapped ragflowReference
	if err := json.Unmarshal(reference, &wrapped); err == nil && len(wrapped.Chunks) > 0 {
		return wrapped.Chunks
	}
	var list []ragflowRefChunk
	if err := json.Unmarshal(reference, &list); err == nil {
		return list
	}
	return nil
}

func citedChunkIndexes(answer string, chunkCount int) []int {
	seen := map[int]struct{}{}
	order := make([]int, 0)
	for _, match := range citationMarker.FindAllStringSubmatch(answer, -1) {
		raw := match[1]
		if raw == "" {
			raw = match[2]
		}
		index, err := strconv.Atoi(raw)
		if err != nil || index < 0 || index >= chunkCount {
			continue
		}
		if _, ok := seen[index]; ok {
			continue
		}
		seen[index] = struct{}{}
		order = append(order, index)
	}
	return order
}

func parsePositions(raw json.RawMessage) []CitationPosition {
	if len(bytesTrim(raw)) == 0 {
		return nil
	}
	var nested [][]float64
	if err := json.Unmarshal(raw, &nested); err == nil {
		return positionsFromRows(nested)
	}
	var objects []map[string]interface{}
	if err := json.Unmarshal(raw, &objects); err == nil {
		rows := make([][]float64, 0, len(objects))
		for _, object := range objects {
			rows = append(rows, []float64{
				asFloat(object["page"]),
				asFloat(object["left"]),
				asFloat(object["right"]),
				asFloat(object["top"]),
				asFloat(object["bottom"]),
			})
		}
		return positionsFromRows(rows)
	}
	return nil
}

func positionsFromRows(rows [][]float64) []CitationPosition {
	out := make([]CitationPosition, 0, len(rows))
	for _, row := range rows {
		if len(row) < 5 {
			continue
		}
		page := int(math.Round(row[0]))
		out = append(out, CitationPosition{
			Page: page, Left: row[1], Right: row[2], Top: row[3], Bottom: row[4],
		})
	}
	return out
}

func pageFromPositions(positions []CitationPosition) (int, bool) {
	if len(positions) == 0 {
		return 0, false
	}
	return positions[0].Page, true
}

func pageFromRaw(raw json.RawMessage) int {
	trimmed := string(bytesTrim(raw))
	if trimmed == "" || trimmed == "null" {
		return 0
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return int(math.Round(number))
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return pageFromText(text)
	}
	return 0
}

func pageFromText(text string) int {
	match := pageInContent.FindStringSubmatch(text)
	if len(match) < 2 {
		return 0
	}
	page, err := strconv.Atoi(match[1])
	if err != nil || page <= 0 {
		return 0
	}
	return page
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func asFloat(value interface{}) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		number, _ := typed.Float64()
		return number
	case string:
		number, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return number
	default:
		return 0
	}
}

func bytesTrim(raw json.RawMessage) []byte {
	return []byte(strings.TrimSpace(string(raw)))
}
