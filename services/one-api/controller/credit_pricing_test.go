package controller

import "testing"

func TestCreditPricingValidation(t *testing.T) {
	for _, raw := range []string{`{}`, `{"test":{"input":0,"output":0.6}}`} {
		if err := validateModelCreditPricing(raw); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{`null`, `[]`, `{"test":{"input":-1,"output":2}}`, `{"test":{"input":1}}`, `{"test":{"input":1,"output":1,"display":-1}}`, `{"test":{"input":1,"output":1,"display":"0.5"}}`} {
		if validateModelCreditPricing(raw) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	for _, raw := range []string{`{}`, `{"creditPricingBase":1}`, `{"creditPricingBase":0.000001}`} {
		if err := validateCreditPricingBase(raw); err != nil {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{`{"creditPricingBase":null}`, `{"creditPricingBase":0}`, `{"creditPricingBase":"1"}`} {
		if validateCreditPricingBase(raw) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}
