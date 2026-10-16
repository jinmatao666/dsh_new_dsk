package controller

import "testing"

func TestVisionProbeRequiresExactExpectedColor(t *testing.T) {
	probe := visionProbe{expected: "red", image: "unused"}
	cases := []struct {
		response string
		want     bool
	}{
		{response: "red", want: true},
		{response: " Red. ", want: true},
		{response: "The image is red", want: false},
		{response: "green", want: false},
		{response: "I cannot view images, but I guess red", want: false},
	}
	for _, test := range cases {
		if got := matchesVisionProbe(test.response, probe); got != test.want {
			t.Fatalf("matchesVisionProbe(%q) = %v, want %v", test.response, got, test.want)
		}
	}
}

func TestVisionDetectionUsesMultipleDistinctProbes(t *testing.T) {
	if len(visionProbes) < 3 {
		t.Fatalf("vision detection requires at least three probes, got %d", len(visionProbes))
	}
	seen := make(map[string]bool, len(visionProbes))
	for _, probe := range visionProbes {
		if probe.expected == "" || probe.image == "" {
			t.Fatal("vision probe must define an expected answer and image")
		}
		if seen[probe.expected] {
			t.Fatalf("duplicate expected probe answer %q", probe.expected)
		}
		seen[probe.expected] = true
	}
}
