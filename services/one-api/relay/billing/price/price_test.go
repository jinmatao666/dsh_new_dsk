package price

import (
	"github.com/songquanpeng/one-api/common/config"
	"testing"
)

func TestCreditPricesAndSnapshot(t *testing.T) {
	config.OptionMapRWMutex.Lock()
	old := config.OptionMap
	config.OptionMap = map[string]string{OptionKey: `{"test":{"input":0.15,"output":0.6,"cache_read":0.03,"cache_write":0.2}}`, "SystemDeploymentSettings": `{"edition":"operations","creditPricingBase":1}`}
	config.OptionMapRWMutex.Unlock()
	defer func() { config.OptionMapRWMutex.Lock(); config.OptionMap = old; config.OptionMapRWMutex.Unlock() }()
	s, err := Resolve("test", 2, 4, 1)
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.Calculate(1000, 500, 800, 0)
	if err != nil {
		t.Fatal(err)
	}
	if r.Quota != 354 || r.InputTokens != 200 {
		t.Fatalf("unexpected receipt %+v", r)
	}
	if _, err = s.Calculate(1000, 500, 900, 200); err == nil {
		t.Fatal("accepted overlapping cache usage")
	}
	r, err = s.Calculate(1000, 0, 0, 1000)
	if err != nil || r.Quota != 200 {
		t.Fatalf("input-only cache creation %+v %v", r, err)
	}
	q, err := s.Reserve(1000, 500)
	if err != nil || q != 500 {
		t.Fatalf("reservation %d %v", q, err)
	}
	config.OptionMapRWMutex.Lock()
	config.OptionMap["SystemDeploymentSettings"] = `{"creditPricingBase":2}`
	config.OptionMapRWMutex.Unlock()
	r, _ = s.Calculate(1000, 500, 800, 0)
	if r.Quota != 354 {
		t.Fatal("in-flight price changed")
	}
	next, _ := Resolve("test", 2, 4, 1)
	r, _ = next.Calculate(1000, 500, 800, 0)
	if r.Quota != 708 {
		t.Fatal("new request missed new base")
	}
	legacy, _ := Resolve("other", 0.15, 4, 1)
	r, _ = legacy.Calculate(1000, 500, 800, 0)
	if r.Quota != 450 {
		t.Fatal("legacy model price changed")
	}
}

func TestCreditDecimalRounding(t *testing.T) {
	s := Snapshot{Base: 1, Input: 0.15, Output: 0.6, CacheRead: 0.03, CacheWrite: 0.15, Group: 1, QuotaPerUnit: 1000}
	for _, test := range []struct {
		tokens int
		quota  int64
	}{{1000, 150}, {1, 1}, {20, 3}, {0, 0}} {
		r, err := s.Calculate(test.tokens, 0, 0, 0)
		if err != nil || r.Quota != test.quota {
			t.Fatalf("%+v: %+v %v", test, r, err)
		}
	}
	s.Input = 0
	s.Output = 0
	s.CacheRead = 0
	s.CacheWrite = 0
	r, err := s.Calculate(1000, 500, 800, 0)
	if err != nil || r.Quota != 0 {
		t.Fatal("free model charged")
	}
}
