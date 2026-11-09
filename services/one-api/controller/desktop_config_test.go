package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
)

func TestDesktopConfigPublicFields(t *testing.T) {
	config.OptionMapRWMutex.Lock()
	previousMap := config.OptionMap
	if config.OptionMap == nil {
		config.OptionMap = make(map[string]string)
	}
	previous, existed := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMap["SystemDeploymentSettings"] = `{"network":"intranet","operator":"张运维","phone":"0571-12345678","secret":"must-not-leak","features":{"internet":{"automations":false,"connectors":true},"intranet":{"automations":true,"connectors":false}}}`
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		config.OptionMapRWMutex.Lock()
		defer config.OptionMapRWMutex.Unlock()
		if previousMap == nil {
			config.OptionMap = nil
			return
		}
		if existed {
			config.OptionMap["SystemDeploymentSettings"] = previous
		} else {
			delete(config.OptionMap, "SystemDeploymentSettings")
		}
	})
	r := gin.New()
	r.GET("/api/desktop-config", GetDesktopConfig)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/desktop-config", nil))
	if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("response: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Success bool                   `json:"success"`
		Data    map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Success || len(body.Data) != 11 || body.Data["internetCatalogPolicy"] != "disable" || body.Data["edition"] != "operations" || body.Data["network"] != "intranet" || body.Data["operator"] != "张运维" || body.Data["phone"] != "0571-12345678" {
		t.Fatalf("unexpected public data: %+v", body)
	}
	featurePages, ok := body.Data["featurePages"].(map[string]interface{})
	if !ok || featurePages["landMarket"] == nil || featurePages["policyEncyclopedia"] == nil {
		t.Fatalf("missing featurePages: %+v", body.Data["featurePages"])
	}
	config.OptionMapRWMutex.Lock()
	config.OptionMap["SystemDeploymentSettings"] = `{"network":"unknown"}`
	config.OptionMapRWMutex.Unlock()
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/desktop-config", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("invalid config response: %d", w.Code)
	}
}

func TestDesktopPluginSettings(t *testing.T) {
	for _, enabled := range []string{"true", "false"} {
		settings, err := parseDesktopDeploymentSettings(`{"network":"internet","plugins":{"browserAssistant":` + enabled + `,"secret":"hidden"}}`)
		if err != nil || settings.Plugins.BrowserAssistant != (enabled == "true") {
			t.Fatalf("plugins: %+v %v", settings, err)
		}
	}
	legacy, err := parseDesktopDeploymentSettings(`{"network":"internet"}`)
	if err != nil || !legacy.Plugins.BrowserAssistant {
		t.Fatalf("legacy plugins: %+v %v", legacy, err)
	}
	for _, value := range []string{`null`, `{}`, `{"browserAssistant":"false"}`, `{"browserAssistant":null}`} {
		if _, err := parseDesktopDeploymentSettings(`{"network":"internet","plugins":` + value + `}`); err == nil {
			t.Fatalf("accepted plugins %s", value)
		}
	}
}

func TestDesktopFeatureSettings(t *testing.T) {
	legacyFlags, err := parseDesktopDeploymentSettings(`{"network":"intranet","features":{"internet":{"automations":false,"connectors":true},"intranet":{"automations":true,"connectors":false}}}`)
	if err != nil || legacyFlags.Features["internet"].Automations || legacyFlags.Features["intranet"].Connectors || !legacyFlags.Features["internet"].KnowledgeBases || !legacyFlags.Features["intranet"].KnowledgeBases ||
		legacyFlags.Features["internet"].LandMarket || legacyFlags.Features["intranet"].LandMarket ||
		legacyFlags.Features["internet"].PolicyEncyclopedia || legacyFlags.Features["intranet"].PolicyEncyclopedia {
		t.Fatalf("legacy feature settings: %+v %v", legacyFlags, err)
	}
	for _, invalid := range []string{`null`, `"true"`, `1`} {
		if _, err := parseDesktopDeploymentSettings(`{"network":"internet","features":{"internet":{"automations":true,"connectors":true,"knowledgeBases":` + invalid + `},"intranet":{"automations":true,"connectors":false}}}`); err == nil {
			t.Fatalf("accepted invalid knowledge flag: %s", invalid)
		}
	}
	settings, err := parseDesktopDeploymentSettings(`{"network":"internet","features":{"internet":{"automations":false,"connectors":false,"knowledgeBases":true},"intranet":{"automations":true,"connectors":true,"knowledgeBases":false},"secret":{"connectors":true}}}`)
	if err != nil || len(settings.Features) != 2 || settings.Features["internet"].Connectors || !settings.Features["intranet"].Connectors || !settings.Features["internet"].KnowledgeBases {
		t.Fatalf("settings: %+v %v", settings, err)
	}
	legacy, err := parseDesktopDeploymentSettings(`{"network":"intranet"}`)
	if err != nil || !legacy.Features["internet"].Connectors || legacy.Features["intranet"].Connectors || !legacy.Features["intranet"].Automations || !legacy.Features["intranet"].KnowledgeBases ||
		legacy.Features["internet"].LandMarket || legacy.Features["intranet"].LandMarket ||
		legacy.Features["internet"].PolicyEncyclopedia || legacy.Features["intranet"].PolicyEncyclopedia {
		t.Fatalf("defaults: %+v %v", legacy, err)
	}
	for _, raw := range []string{`null`, `{}`, `{"network":null}`, `{"network":"internet","operator":null}`, `{"network":"internet","features":null}`, `{"network":"internet","features":{}}`, `{"network":"internet","features":{"internet":{"automations":"false","connectors":true,"knowledgeBases":true}}}`} {
		if _, err := parseDesktopDeploymentSettings(raw); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestDesktopFeaturePages(t *testing.T) {
	settings, err := parseDesktopDeploymentSettings(`{"network":"internet","featurePages":{"landMarket":{"url":" https://land.example/ "},"policyEncyclopedia":{"url":"https://policy.example/docs"}}}`)
	if err != nil || settings.FeaturePages["landMarket"].URL != "https://land.example/" || settings.FeaturePages["policyEncyclopedia"].URL != "https://policy.example/docs" {
		t.Fatalf("feature pages: %+v %v", settings.FeaturePages, err)
	}
	for _, raw := range []string{
		`{"network":"internet","featurePages":null}`,
		`{"network":"internet","featurePages":{"landMarket":{"url":"ftp://bad"}}}`,
		`{"network":"internet","featurePages":{"policyEncyclopedia":{"url":true}}}`,
		`{"network":"internet","featurePages":{"landMarket":{"url":"not-a-url"}}}`,
	} {
		if _, err := parseDesktopDeploymentSettings(raw); err == nil {
			t.Fatalf("accepted invalid featurePages: %s", raw)
		}
	}
}

func TestDesktopEditionSettings(t *testing.T) {
	for _, edition := range []string{"government", "operations"} {
		settings, err := parseDesktopDeploymentSettings(`{"network":"internet","edition":"` + edition + `"}`)
		if err != nil || settings.Edition != edition {
			t.Fatalf("edition: %+v %v", settings, err)
		}
	}
	legacy, err := parseDesktopDeploymentSettings(`{"network":"intranet"}`)
	if err != nil || legacy.Edition != "operations" {
		t.Fatalf("legacy: %+v %v", legacy, err)
	}
	for _, value := range []string{`null`, `"unknown"`, `true`, `123`} {
		if _, err := parseDesktopDeploymentSettings(`{"network":"internet","edition":` + value + `}`); err == nil {
			t.Fatalf("accepted edition %s", value)
		}
	}
}

func TestDesktopInternetCatalogPolicy(t *testing.T) {
	for _, policy := range []string{"hide", "disable"} {
		settings, err := parseDesktopDeploymentSettings(`{"network":"intranet","internetCatalogPolicy":"` + policy + `"}`)
		if err != nil || settings.InternetCatalogPolicy != policy {
			t.Fatalf("policy %s: %v", policy, err)
		}
	}
	for _, value := range []string{`null`, `true`, `1`, `"unknown"`} {
		if _, err := parseDesktopDeploymentSettings(`{"network":"intranet","internetCatalogPolicy":` + value + `}`); err == nil {
			t.Fatalf("accepted invalid policy %s", value)
		}
	}
}

func TestDesktopIndependentCatalogPolicies(t *testing.T) {
	for _, legacy := range []string{"hide", "disable"} {
		settings, err := parseDesktopDeploymentSettings(`{"network":"intranet","internetCatalogPolicy":"` + legacy + `"}`)
		if err != nil || settings.InternetSkillPolicy != legacy || settings.InternetExpertPolicy != legacy {
			t.Fatalf("legacy policy lost: %+v %v", settings, err)
		}
	}
	settings, err := parseDesktopDeploymentSettings(`{"network":"intranet","internetSkillPolicy":"hide","internetExpertPolicy":"disable"}`)
	if err != nil || settings.InternetSkillPolicy != "hide" || settings.InternetExpertPolicy != "disable" {
		t.Fatalf("independent policies lost: %+v %v", settings, err)
	}
	for _, key := range []string{"internetSkillPolicy", "internetExpertPolicy"} {
		for _, value := range []string{`null`, `true`, `1`, `"unknown"`} {
			if _, err := parseDesktopDeploymentSettings(`{"network":"intranet","` + key + `":` + value + `}`); err == nil {
				t.Fatalf("accepted invalid %s: %s", key, value)
			}
		}
	}
}

func TestDesktopNetworkTransitionResetsOnlyIntranetPreset(t *testing.T) {
	internet := desktopFeatureFlags{Connectors: true, KnowledgeBases: true, PolicyEncyclopedia: true}
	initial := `{"network":"internet","features":{"internet":{"automations":false,"connectors":true,"knowledgeBases":true,"policyEncyclopedia":true},"intranet":{"automations":false,"connectors":true}}}`
	candidate := `{"network":"intranet","creditPricingBase":45,"features":{"internet":{"automations":true,"connectors":false},"intranet":{"automations":false,"connectors":true}},"internetSkillPolicy":"hide","internetExpertPolicy":"hide"}`
	switchMode := func(before, next string) (string, desktopDeploymentSettings) {
		t.Helper()
		raw, err := applyDesktopNetworkTransition(before, next)
		if err != nil {
			t.Fatal(err)
		}
		config, err := parseDesktopDeploymentSettings(raw)
		if err != nil {
			t.Fatal(err)
		}
		return raw, config
	}
	raw, entered := switchMode(initial, candidate)
	if entered.Features["internet"] != internet || entered.Features["intranet"] != (desktopFeatureFlags{Automations: true}) ||
		entered.Resources == nil || entered.Resources.Source != "offline" || entered.Resources.AutoDetect ||
		entered.InternetSkillPolicy != "disable" || entered.InternetExpertPolicy != "disable" {
		t.Fatalf("unexpected intranet preset: %+v", entered)
	}
	var unchanged map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &unchanged); err != nil || string(unchanged["creditPricingBase"]) != "45" {
		t.Fatalf("unrelated setting changed: %s, %v", raw, err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		t.Fatal(err)
	}
	entered.Features["intranet"] = desktopFeatureFlags{Automations: true, KnowledgeBases: true}
	fields["features"], _ = json.Marshal(entered.Features)
	changed, _ := json.Marshal(fields)
	_, live := switchMode(raw, string(changed))
	if !live.Features["intranet"].KnowledgeBases {
		t.Fatal("saving within intranet must allow changes")
	}
	fields["network"], _ = json.Marshal("internet")
	returning, _ := json.Marshal(fields)
	back, restored := switchMode(string(changed), string(returning))
	if restored.Features["internet"] != internet {
		t.Fatalf("internet options lost: %+v", restored.Features)
	}
	_, again := switchMode(back, string(changed))
	if again.Features["intranet"].KnowledgeBases || !again.Features["intranet"].Automations {
		t.Fatalf("previous intranet edits survived reentry: %+v", again.Features)
	}
}
