package controller

import "testing"

func TestStripJSONFences(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"no fence", `{"a":1}`, `{"a":1}`},
		{"json fence", "```json\n{\"a\":1}\n```", `{"a":1}`},
		{"plain fence", "```\n{\"a\":1}\n```", `{"a":1}`},
		{"surrounding whitespace", "  {\"a\":1}  ", `{"a":1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := stripJSONFences(tc.in); got != tc.want {
				t.Fatalf("stripJSONFences(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestParseRewardRuleFromModelOutput(t *testing.T) {
	t.Run("per_unit ok", func(t *testing.T) {
		raw := "```json\n{\"version\":1,\"currency\":\"CNY\",\"mode\":\"per_unit\",\"unit_price\":5,\"note\":\"每个有效用户奖励5元\"}\n```"
		rule, err := parseRewardRuleFromModelOutput(raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if rule.Mode != "per_unit" || rule.UnitPrice != 5 {
			t.Fatalf("unexpected rule: %+v", rule)
		}
	})

	t.Run("tiered ok", func(t *testing.T) {
		raw := `{"mode":"tiered","tiers":[{"min_count":0,"max_count":99,"unit_price":5},{"min_count":100,"max_count":0,"unit_price":8}],"note":"x"}`
		rule, err := parseRewardRuleFromModelOutput(raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if rule.Version != 1 || rule.Currency != "CNY" {
			t.Fatalf("defaults not applied: %+v", rule)
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		if _, err := parseRewardRuleFromModelOutput("not json"); err == nil {
			t.Fatal("expected error for invalid json")
		}
	})

	t.Run("invalid rule rejected", func(t *testing.T) {
		// 档位存在空洞，应被 ValidateRewardRule 拒绝。
		raw := `{"mode":"tiered","tiers":[{"min_count":0,"max_count":50,"unit_price":5},{"min_count":100,"max_count":0,"unit_price":8}]}`
		if _, err := parseRewardRuleFromModelOutput(raw); err == nil {
			t.Fatal("expected validation error for non-contiguous tiers")
		}
	})

	t.Run("empty output", func(t *testing.T) {
		if _, err := parseRewardRuleFromModelOutput("   "); err == nil {
			t.Fatal("expected error for empty output")
		}
	})
}
