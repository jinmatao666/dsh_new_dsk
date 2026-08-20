package model

import (
	"strings"
	"testing"
)

func TestSplitContent_NoMarkers(t *testing.T) {
	in := "# Just a heading\n\nSome prose with `inline` text.\n"
	body, assets := SplitContent(in)
	if body != in {
		t.Fatalf("body should equal input when no markers, got %q", body)
	}
	if assets != "" {
		t.Fatalf("assets should be empty when no markers, got %q", assets)
	}
}

func TestSplitContent_ScriptHeader(t *testing.T) {
	in := "# Skill\n\nIntro.\n\n## Script: scripts/hello.py\n\n" +
		"```python\nprint(\"hi\")\n```\n\nMore prose.\n"
	body, assets := SplitContent(in)
	if assets == "" {
		t.Fatal("expected assets to be populated")
	}
	if strings.Contains(body, "## Script:") {
		t.Fatalf("body still contains Script header: %q", body)
	}
	if !strings.Contains(body, "Intro.") || !strings.Contains(body, "More prose.") {
		t.Fatalf("body lost surrounding prose: %q", body)
	}
	// assets should be the verbatim block — header + fence + code + closing fence
	wantAssets := "## Script: scripts/hello.py\n\n```python\nprint(\"hi\")\n```"
	if assets != wantAssets {
		t.Fatalf("assets mismatch:\n  want=%q\n  got =%q", wantAssets, assets)
	}
}

func TestSplitContent_FileMarker_NestedFences(t *testing.T) {
	// Asset body contains its own ``` fences — splitter must use LAST closing
	// fence within the span.
	in := strings.Join([]string{
		"# Top",
		"",
		"<!-- file: README.md -->",
		"```md",
		"# inner heading",
		"",
		"```bash",
		"echo hello",
		"```",
		"",
		"more inner text",
		"```",
		"",
		"trailing prose",
		"",
	}, "\n")
	body, assets := SplitContent(in)
	if !strings.Contains(body, "trailing prose") {
		t.Fatalf("body lost trailing prose: %q", body)
	}
	if strings.Contains(body, "<!-- file:") {
		t.Fatalf("body still contains file marker: %q", body)
	}
	if !strings.Contains(assets, "<!-- file: README.md -->") {
		t.Fatalf("assets missing header: %q", assets)
	}
	if !strings.Contains(assets, "more inner text") {
		t.Fatalf("inner content was truncated: %q", assets)
	}
	if !strings.Contains(assets, "echo hello") {
		t.Fatalf("inner fence content was lost: %q", assets)
	}
}

func TestSplitContent_TwoBlocksMixedHeaders(t *testing.T) {
	in := strings.Join([]string{
		"# Skill",
		"",
		"## Script: scripts/a.py",
		"",
		"```python",
		"print('a')",
		"```",
		"",
		"<!-- file: README.md -->",
		"```md",
		"# readme",
		"```",
		"",
		"end",
		"",
	}, "\n")
	body, assets := SplitContent(in)
	if !strings.Contains(body, "end") {
		t.Fatalf("body lost trailing prose: %q", body)
	}
	if strings.Contains(body, "Script:") || strings.Contains(body, "<!-- file:") {
		t.Fatalf("body has leftover marker: %q", body)
	}
	// Both blocks must be present in assets, in source order, separated by blank line.
	if !strings.Contains(assets, "## Script: scripts/a.py") {
		t.Fatalf("missing first block: %q", assets)
	}
	if !strings.Contains(assets, "<!-- file: README.md -->") {
		t.Fatalf("missing second block: %q", assets)
	}
	idxA := strings.Index(assets, "Script: scripts/a.py")
	idxB := strings.Index(assets, "<!-- file: README.md -->")
	if idxA > idxB {
		t.Fatalf("blocks out of order in assets: %q", assets)
	}
	if !strings.Contains(assets, "\n\n<!-- file:") {
		t.Fatalf("expected blank line between blocks: %q", assets)
	}
}

func TestSplitContent_HeaderWithoutFenceLeftAlone(t *testing.T) {
	// "Script:" inside narrative (no fence) must not be carved.
	in := "# Heading\n\n## Script: notes.txt\n\nNo fence follows. Just prose.\n"
	body, assets := SplitContent(in)
	if assets != "" {
		t.Fatalf("should not carve when no fence: %q", assets)
	}
	if body != in {
		t.Fatalf("body should equal input when no carve happened")
	}
}
