package price

import (
	"github.com/songquanpeng/one-api/common/config"
	"testing"
)

func TestDisplayMultiplierDefaultOverrideAndBillingIsolation(t *testing.T) {
	config.OptionMapRWMutex.Lock()
	old := config.OptionMap
	config.OptionMap = map[string]string{}
	config.OptionMapRWMutex.Unlock()
	defer func() { config.OptionMapRWMutex.Lock(); config.OptionMap = old; config.OptionMapRWMutex.Unlock() }()
	for _, test := range []struct {
		raw      string
		expected float64
	}{
		{`{}`, 0.375},
		{`{"test":{"input":0.15,"output":0.6}}`, 0.375},
		{`{"test":{"input":0.15,"output":0.6,"display":0.8}}`, 0.8},
		{`{"test":{"input":0.15,"output":0.6,"display":0}}`, 0},
	} {
		config.OptionMapRWMutex.Lock()
		config.OptionMap[OptionKey] = test.raw
		config.OptionMapRWMutex.Unlock()
		value, err := DisplayMultiplier("test", 0.15, 0.6)
		if err != nil || value == nil || *value != test.expected {
			t.Fatalf("display %v err %v", value, err)
		}
		if test.raw != `{}` {
			p, err := Resolve("test", 1, 1, 1)
			if err != nil {
				t.Fatal(err)
			}
			r, err := p.Calculate(1000, 500, 0, 0)
			if err != nil || r.Quota != 450 {
				t.Fatalf("display changed billing %+v %v", r, err)
			}
		}
	}
}
