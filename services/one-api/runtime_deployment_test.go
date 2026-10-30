package main

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/deployment"
	"github.com/songquanpeng/one-api/router"
)

// This test consumes the production frontend build embedded in the program.
func TestRuntimeDeploymentBuiltAssets(t *testing.T) {
	previous, theme := deployment.Current, config.Theme
	debug := config.DebugEnabled
	config.DebugEnabled = true
	t.Cleanup(func() { deployment.Current = previous; config.Theme = theme; config.DebugEnabled = debug })
	config.Theme = "air"
	for _, pair := range [][2]string{{"", ""}, {"/dsh-admin", "/dsh-api"}, {"/unit/control", "/unit/service"}} {
		deployment.Current = deployment.Settings{AdminPrefix: pair[0], APIPrefix: pair[1], OrgPrefix: "/business"}
		r := gin.New()
		router.SetWebRouter(r, buildFS)
		h := deployment.Current.Handler(r)
		request := func(path string) *httptest.ResponseRecorder {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
			return w
		}
		for _, route := range []string{"/", "/index.html", "/login", "/skill/reviews/42/test"} {
			w := request(pair[0] + route)
			if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `<base href="`+pair[0]+`/">`) || !strings.Contains(w.Body.String(), "__DSH_DEPLOYMENT__") {
				t.Fatalf("%s: %d %s", route, w.Code, w.Body.String())
			}
			if strings.Contains(w.Header().Get("Cache-Control"), "max-age") {
				t.Fatal("runtime HTML is cached")
			}
			for _, match := range regexp.MustCompile(`(?:src|href)="([^"]+)"`).FindAllStringSubmatch(w.Body.String(), -1) {
				resource := match[1]
				if resource == pair[0]+"/" {
					continue
				} // base element
				if strings.HasPrefix(resource, "http") {
					continue
				}
				if strings.HasPrefix(resource, "/") {
					t.Fatalf("build includes absolute root asset %s", resource)
				}
				asset := request(pair[0] + "/" + strings.TrimPrefix(resource, "./"))
				if asset.Code != 200 || strings.Contains(asset.Header().Get("Content-Type"), "text/html") {
					t.Fatalf("missing emitted asset %s: %d", resource, asset.Code)
				}
			}
		}
		for _, icon := range []string{"/brand-mark.svg", "/brand-wordmark.svg", "/skill-icons/assistant.png"} {
			w := request(pair[0] + icon)
			if w.Code != 200 || strings.Contains(w.Header().Get("Content-Type"), "text/html") {
				t.Fatal(icon, w.Code)
			}
		}
	}
}

func TestRuntimeDeploymentBuiltOrgAssets(t *testing.T) {
	previous := deployment.Current
	t.Cleanup(func() { deployment.Current = previous })
	for _, prefix := range []string{"", "/business", "/unit/organization"} {
		deployment.Current = deployment.Settings{OrgPrefix: prefix}
		r := gin.New()
		router.SetOrgRouter(r, orgBuildFS)
		h := deployment.Current.OrgHandler(r)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", prefix+"/members?p=2", nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), `<base href="`+prefix+`/">`) {
			t.Fatal(prefix, w.Code, w.Body.String())
		}
		for _, match := range regexp.MustCompile(`(?:src|href)="([^"]+)"`).FindAllStringSubmatch(w.Body.String(), -1) {
			resource := match[1]
			if resource == prefix+"/" {
				continue
			}
			if strings.HasPrefix(resource, "/") {
				t.Fatal("root asset in organization build", resource)
			}
			asset := httptest.NewRecorder()
			h.ServeHTTP(asset, httptest.NewRequest("GET", prefix+"/"+strings.TrimPrefix(resource, "./"), nil))
			if asset.Code != 200 || strings.Contains(asset.Header().Get("Content-Type"), "text/html") {
				t.Fatal(prefix, resource, asset.Code)
			}
		}
	}
}
