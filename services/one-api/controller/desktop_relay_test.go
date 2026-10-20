package controller

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
)

func TestDesktopTunnelConfiguration(t *testing.T) {
	config.OptionMapRWMutex.Lock()
	original := config.OptionMap
	config.OptionMapRWMutex.Unlock()
	t.Cleanup(func() { config.OptionMapRWMutex.Lock(); config.OptionMap = original; config.OptionMapRWMutex.Unlock() })
	for _, raw := range []string{
		`{"network":"intranet","resources":{"source":"proxy","transport":"tunnel","proxyUrl":"","autoDetect":false,"probeUrls":[]}}`,
		`{"network":"intranet","resources":{"source":"proxy","transport":"tunnel","proxyUrl":"https://platform.example:3300","autoDetect":false,"probeUrls":[]}}`,
	} {
		s, err := parseDesktopDeploymentSettings(raw)
		if err != nil || s.Resources.Transport != "tunnel" {
			t.Fatal(s, err)
		}
		config.OptionMapRWMutex.Lock()
		config.OptionMap = map[string]string{"SystemDeploymentSettings": raw}
		config.OptionMapRWMutex.Unlock()
		router := gin.New()
		router.GET("/api/desktop-config", GetDesktopConfig)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/api/desktop-config", nil))
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"transport":"tunnel"`) {
			t.Fatal(response.Body.String())
		}
	}
	if err := validateDesktopResources(desktopResourceSettings{Source: "proxy", Transport: "arbitrary"}); err == nil {
		t.Fatal("unknown transport accepted")
	}
	if err := validateDesktopResources(desktopResourceSettings{Source: "offline", BypassHosts: []string{"internal:3300"}}); err == nil {
		t.Fatal("port included in bypass host")
	}
}
