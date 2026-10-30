package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/songquanpeng/one-api/common/deployment"
)

func TestSkillTestRuntimeDeploymentRelay(t *testing.T) {
	previous := deployment.Current
	t.Cleanup(func() { deployment.Current = previous })
	t.Setenv("SKILL_TEST_RELAY_URL", "")
	for _, prefix := range []string{"", "/dsh-api", "/unit/service"} {
		deployment.Current = deployment.Settings{APIPrefix: prefix}
		called := false
		server := httptest.NewServer(deployment.Current.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			if r.URL.Path != "/v1/chat/completions" || r.Method != "POST" || r.Header.Get("Authorization") != "Bearer sk-test-only" {
				t.Error("relay request changed")
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"done"}}]}`))
		})))
		t.Cleanup(server.Close)
		t.Setenv("PORT", strings.TrimPrefix(server.URL, "http://127.0.0.1:"))
		message, err := skillTestCompletion(context.Background(), "test-model", "test-only", nil)
		if err != nil || !called || message.Content != "done" {
			t.Fatal(prefix, err, message)
		}
	}
}
