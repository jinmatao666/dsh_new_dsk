package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDecodeProvinceTicketUserSupportsStringAndObjectResult(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"Account":"u1","Name":"张三","IsActive":true}`),
		json.RawMessage(`"{\"Account\":\"u1\",\"Name\":\"张三\",\"IsActive\":true}"`),
	} {
		user, err := decodeProvinceTicketUser(raw)
		if err != nil {
			t.Fatal(err)
		}
		if user.Account != "u1" || user.Name != "张三" || !provinceActive(user.IsActive) {
			t.Fatalf("unexpected decoded user: %+v", user)
		}
	}
}

func TestProvinceActiveSupportsConfiguredNumericConvention(t *testing.T) {
	t.Setenv("PARVIS_PROVINCE_ZERO_IS_ACTIVE", "")
	if !provinceActive(json.RawMessage(`1`)) {
		t.Fatal("expected 1 to be active by default")
	}
	if provinceActive(json.RawMessage(`0`)) {
		t.Fatal("expected 0 to be inactive by default")
	}

	t.Setenv("PARVIS_PROVINCE_ZERO_IS_ACTIVE", "true")
	if !provinceActive(json.RawMessage(`0`)) {
		t.Fatal("expected 0 to be active when configured")
	}
	if provinceActive(json.RawMessage(`1`)) {
		t.Fatal("expected 1 to be inactive when zero is configured as active")
	}
	if !provinceActive(json.RawMessage(`true`)) || provinceActive(json.RawMessage(`false`)) {
		t.Fatal("boolean activity values must keep their normal meaning")
	}
}

func TestValidateProvinceTicketUsesConfiguredEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if r.URL.Query().Get("ticket") != "ticket-value" {
			t.Fatalf("ticket was not forwarded")
		}
		if r.Header.Get("Accept") != "application/json, text/plain, */*" {
			t.Fatalf("unexpected Accept header: %q", r.Header.Get("Accept"))
		}
		if r.Header.Get("User-Agent") != "test-province-user-agent" {
			t.Fatalf("unexpected User-Agent header: %q", r.Header.Get("User-Agent"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"result": map[string]any{"Account": "u1", "Name": "张三", "IsActive": 1},
		})
	}))
	defer server.Close()

	t.Setenv("PARVIS_PROVINCE_TICKET_VALIDATE_URL", server.URL)
	t.Setenv("PARVIS_PROVINCE_TICKET_USER_AGENT", "test-province-user-agent")
	previousClient := provinceHTTPClient
	provinceHTTPClient = &http.Client{Timeout: time.Second}
	defer func() { provinceHTTPClient = previousClient }()

	user, err := validateProvinceTicket("ticket-value")
	if err != nil {
		t.Fatal(err)
	}
	if user.Account != "u1" || !provinceActive(user.IsActive) {
		t.Fatalf("unexpected user: %+v", user)
	}
}

func TestPrivateDeploymentRequiresExplicitProvinceEndpoint(t *testing.T) {
	t.Setenv("PARVIS_DEPLOYMENT_MODE", "private")
	t.Setenv("PARVIS_PROVINCE_TICKET_VALIDATE_URL", "")
	if _, err := validateProvinceTicket("ticket-value"); err == nil {
		t.Fatal("expected missing private endpoint to fail")
	}
}

func TestProvinceInternalKeyAuthorized(t *testing.T) {
	t.Setenv("PARVIS_PROVINCE_SSO_INTERNAL_KEY", "0123456789abcdef0123456789abcdef")
	if !provinceInternalKeyAuthorized("0123456789abcdef0123456789abcdef") {
		t.Fatal("expected matching internal key to be accepted")
	}
	if provinceInternalKeyAuthorized("wrong-key") {
		t.Fatal("expected incorrect internal key to be rejected")
	}
	if provinceInternalKeyAuthorized("") {
		t.Fatal("expected empty internal key to be rejected")
	}
}

func TestProvinceInternalKeyCannotBeEnabledWithEmptyConfiguration(t *testing.T) {
	t.Setenv("PARVIS_PROVINCE_SSO_INTERNAL_KEY", "")
	if provinceInternalKeyAuthorized("") {
		t.Fatal("empty configured key must never authorize a request")
	}
	t.Setenv("PARVIS_PROVINCE_SSO_INTERNAL_KEY", "too-short")
	if provinceInternalKeyAuthorized("too-short") {
		t.Fatal("internal keys shorter than 32 characters must be rejected")
	}
}
