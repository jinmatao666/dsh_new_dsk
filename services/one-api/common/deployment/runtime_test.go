package deployment

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func settings(t *testing.T, values map[string]string) Settings {
	t.Helper()
	s, err := Parse(func(key string) string { return values[key] })
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestRuntimeDeploymentValidation(t *testing.T) {
	s := settings(t, nil)
	if s.AdminPrefix != "" || s.APIPrefix != "" || s.OrgPrefix != "/business" {
		t.Fatal(s)
	}
	for _, pair := range [][2]string{{"", ""}, {"/dsh-admin", "/dsh-api"}, {"/unit/control", "/unit/service"}} {
		settings(t, map[string]string{"DSH_ADMIN_PREFIX": pair[0], "DSH_API_PREFIX": pair[1]})
	}
	for _, invalid := range []map[string]string{
		{"DSH_ADMIN_PREFIX": "relative"}, {"DSH_ADMIN_PREFIX": "//host"},
		{"DSH_API_PREFIX": "/api/"}, {"DSH_API_PREFIX": "/a/../b"}, {"DSH_API_PREFIX": "/a?x"},
		{"DSH_ADMIN_PREFIX": "/a", "DSH_API_PREFIX": "/a/b"},
		{"DSH_PUBLIC_URL": "https://user:pass@example.com/api"}, {"DSH_PUBLIC_URL": "example.com/api"},
		{"DSH_PUBLIC_URL": "https://example.com/api?q=1"}, {"CORS_ALLOW_ORIGINS": "https://example.com/admin"},
		{"DSH_PUBLIC_URL": "https://example.com/other", "DSH_API_PREFIX": "/api"},
		{"CORS_ALLOW_ORIGINS": "*"}, {"CORS_ALLOW_ORIGINS": "file://localhost"},
		{"DSH_TRUSTED_PROXIES": "https://gateway"},
	} {
		if _, err := Parse(func(key string) string { return invalid[key] }); err == nil {
			t.Fatalf("accepted %v", invalid)
		}
	}
	settings(t, map[string]string{"CORS_ALLOW_ORIGINS": "https://example.com,http://tauri.localhost,tauri://localhost", "DSH_TRUSTED_PROXIES": "127.0.0.1,172.20.0.0/16"})
}

func TestRuntimeDeploymentRouting(t *testing.T) {
	for _, pair := range [][2]string{{"", ""}, {"/dsh-admin", "/dsh-api"}, {"/unit/control", "/unit/service"}} {
		s := settings(t, map[string]string{"DSH_ADMIN_PREFIX": pair[0], "DSH_API_PREFIX": pair[1]})
		h := s.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(r.RequestURI)) }))
		for _, resource := range []string{"/api/user/login", "/v1/models", "/v1/chat/completions", "/desktop-updates/files/id", "/downloads/installers/id"} {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("POST", s.APIPrefix+resource+"?a=1%202", nil))
			if w.Code != 200 || w.Body.String() != resource+"?a=1%202" {
				t.Fatal(w.Code, w.Body.String())
			}
		}
		for _, resource := range []string{"/", "/login", "/skill/reviews/42/test", "/static/js/123.chunk.js"} {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", s.AdminPrefix+resource, nil))
			if w.Code != 200 || w.Body.String() != resource {
				t.Fatal(w.Code, w.Body.String())
			}
		}
		if s.AdminPrefix != "" {
			for _, invalid := range []string{"/login", s.APIPrefix + "/login", s.AdminPrefix + "/api/status", "/api/status"} {
				w := httptest.NewRecorder()
				h.ServeHTTP(w, httptest.NewRequest("GET", invalid, nil))
				if w.Code != 404 {
					t.Fatal(invalid, w.Code)
				}
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", s.AdminPrefix+"?x=1", nil))
			if w.Header().Get("Location") != s.AdminPrefix+"/?x=1" {
				t.Fatal(w.Header())
			}
		}
	}
}

func TestRuntimeDeploymentPublicURLsAndBootstrap(t *testing.T) {
	s := settings(t, map[string]string{"DSH_ADMIN_PREFIX": "/unit/admin", "DSH_API_PREFIX": "/unit/api", "DSH_PUBLIC_URL": "https://external.example/unit/api/"})
	r := httptest.NewRequest("GET", "http://internal:3000/api/status", nil)
	r.Header.Set("X-Forwarded-Host", "attacker.example")
	r.Header.Set("X-Forwarded-Proto", "https")
	if got := s.External(r, "desktop-updates/files/id"); got != "https://external.example/unit/api/desktop-updates/files/id" {
		t.Fatal(got)
	}
	for _, external := range []string{"https://third.example/file", "//cdn.example/file", "data:image/png;base64,abc"} {
		if s.External(r, external) != external {
			t.Fatal(external)
		}
	}
	if s.AdminBase("https://old.example") != "https://external.example/unit/admin" {
		t.Fatal(s)
	}
	if s.APIBase("https://old.example") != s.PublicURL {
		t.Fatal(s)
	}
	s.AdminURL = "https://admin.example/unit/admin"
	if s.AdminBase("https://old.example") != s.AdminURL {
		t.Fatal(s)
	}
	markup := string(s.HTML([]byte("<html><head><script src=\"./static/js/main.js\"></script></head></html>")))
	if !strings.Contains(markup, `<head><base href="/unit/admin/"><script>window.__DSH_DEPLOYMENT__=`) || strings.Index(markup, "__DSH_DEPLOYMENT__") > strings.Index(markup, "./static/js/") {
		t.Fatal(markup)
	}
	if strings.Contains(markup, "SESSION_SECRET") {
		t.Fatal("secret in HTML")
	}
	s.PublicURL = ""
	if s.External(r, "/api/models") != "http://internal:3000/unit/api/api/models" {
		t.Fatal("untrusted headers used")
	}
	t.Setenv("DSH_TRUSTED_PROXIES", "127.0.0.1")
	r.RemoteAddr = "127.0.0.1:1234"
	if s.External(r, "/api/models") != "https://internal:3000/unit/api/api/models" {
		t.Fatal("trusted TLS forwarding ignored")
	}
	t.Setenv("DSH_TRUSTED_PROXIES", "")
	if s.External(r, "/api/models") != "http://internal:3000/unit/api/api/models" {
		t.Fatal("disabled proxy trust ignored")
	}
}

func TestRuntimeDeploymentOrgPortal(t *testing.T) {
	s := settings(t, map[string]string{"DSH_ORG_PREFIX": "/unit/business"})
	h := s.OrgHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(r.RequestURI)) }))
	for _, prefix := range []string{"", s.OrgPrefix} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", prefix+"/org-api/members?p=2", nil))
		if w.Body.String() != "/org-api/members?p=2" {
			t.Fatal(w.Body.String())
		}
	}
	if !strings.Contains(string(s.OrgHTML([]byte("<head>"))), `<base href="/unit/business/">`) {
		t.Fatal(s)
	}
}
