package model

import (
	"regexp"
	"strings"
)

// SplitContent carves attachment blocks out of a skill's Content field and
// returns (body, assets) — both plain text.
//
// Two attachment header formats are recognised, both at start of line:
//
//	## Script: <relpath>            (any 1-6 leading '#')
//	<!-- file: <relpath> -->        (anthropic companion-file protocol)
//
// The body of each attachment is a fenced code block. Asset bodies which
// themselves contain ``` fences (markdown READMEs, scripts that echo fences)
// are handled by walking marker-by-marker and using the LAST bare ``` line
// before the next marker as the closing fence.
//
// body   = original content with attachment blocks (header + fence + code +
//          closing fence) removed. Surrounding prose is preserved.
// assets = the carved-out blocks concatenated verbatim (header + fence +
//          code + closing fence), separated by a blank line. Empty if no
//          attachments were found.
func SplitContent(content string) (body string, assets string) {
	markers := collectMarkers(content)
	if len(markers) == 0 {
		return content, ""
	}

	var bodyB, assetsB strings.Builder
	cursor := 0
	carved := 0

	for i, mk := range markers {
		nextStart := len(content)
		if i+1 < len(markers) {
			nextStart = markers[i+1].headerStart
		}
		spanAfterHeader := content[mk.afterHeader:nextStart]

		fence := fenceOpenRe.FindStringIndex(spanAfterHeader)
		if fence == nil {
			continue
		}
		codeStart := mk.afterHeader + fence[1]
		codeRegion := content[codeStart:nextStart]
		closingMatches := closeFenceRe.FindAllStringIndex(codeRegion, -1)
		if len(closingMatches) == 0 {
			continue
		}
		closing := closingMatches[len(closingMatches)-1]
		blockEnd := codeStart + closing[1]

		// Body keeps everything up to (but not including) the header line.
		bodyB.WriteString(content[cursor:mk.headerStart])

		// Assets gets the entire block verbatim.
		if carved > 0 {
			assetsB.WriteString("\n\n")
		}
		assetsB.WriteString(strings.TrimRight(content[mk.headerStart:blockEnd], "\r\n"))
		carved++

		cursor = blockEnd
	}

	bodyB.WriteString(content[cursor:])
	body = collapseRe.ReplaceAllString(bodyB.String(), "\n\n")
	body = strings.TrimRight(body, "\r\n") + "\n"

	if carved == 0 {
		return content, ""
	}
	return body, assetsB.String()
}

var (
	scriptMarkerRe = regexp.MustCompile(`(?m)^#{1,6}[ \t]*Script:[ \t]*(\S+)[ \t]*\r?\n`)
	fileMarkerRe   = regexp.MustCompile(`(?m)^<!--[ \t]*file:[ \t]*([^\n>]+?)[ \t]*-->[ \t]*\r?\n`)
	fenceOpenRe    = regexp.MustCompile(`^[ \t\r\n]*` + "```" + `[\w+-]*\r?\n`)
	closeFenceRe   = regexp.MustCompile(`(?m)^[ \t]*` + "```" + `[ \t]*\r?$`)
	collapseRe     = regexp.MustCompile(`\n{3,}`)
)

type marker struct {
	headerStart int
	afterHeader int
	path        string
}

func collectMarkers(content string) []marker {
	out := make([]marker, 0, 8)
	for _, m := range scriptMarkerRe.FindAllStringSubmatchIndex(content, -1) {
		out = append(out, marker{
			headerStart: m[0],
			afterHeader: m[1],
			path:        strings.TrimSpace(content[m[2]:m[3]]),
		})
	}
	for _, m := range fileMarkerRe.FindAllStringSubmatchIndex(content, -1) {
		out = append(out, marker{
			headerStart: m[0],
			afterHeader: m[1],
			path:        strings.TrimSpace(content[m[2]:m[3]]),
		})
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1].headerStart > out[j].headerStart; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}
