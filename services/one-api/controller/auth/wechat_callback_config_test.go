package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
)

type wechatTestTransport func(*http.Request) (*http.Response, error)

func (f wechatTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestWeChatQRDisabledDoesNotCreateState(t *testing.T) {
	old := config.WeChatAuthEnabled
	config.WeChatAuthEnabled = false
	defer func() { config.WeChatAuthEnabled = old }()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/", nil)
	WeChatQRGenerate(c)
	if !strings.Contains(w.Body.String(), "管理员未开启") {
		t.Fatal(w.Body.String())
	}
}

func TestWeChatQRCallbackOverrideAndFailureCleanup(t *testing.T) {
	oldEnabled, oldID, oldCallback := config.WeChatAuthEnabled, config.WeChatAppID, config.WeChatCallbackURL
	oldTransport := http.DefaultTransport
	defer func() {
		config.WeChatAuthEnabled, config.WeChatAppID, config.WeChatCallbackURL = oldEnabled, oldID, oldCallback
		http.DefaultTransport = oldTransport
	}()
	config.WeChatAuthEnabled = true
	config.WeChatAppID = "test-app"
	config.WeChatCallbackURL = "https://callback.example/api/oauth/wechat"
	for _, valid := range []bool{true, false} {
		var state string
		http.DefaultTransport = wechatTestTransport(func(r *http.Request) (*http.Response, error) {
			if r.URL.Host != "open.weixin.qq.com" {
				t.Fatalf("unexpected request: %s", r.URL.Host)
			}
			if got := r.URL.Query().Get("redirect_uri"); got != config.WeChatCallbackURL {
				t.Fatalf("callback = %q", got)
			}
			state = r.URL.Query().Get("state")
			body := "invalid app response"
			if valid {
				body = `<img src="/connect/qrcode/test_uuid">`
			}
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
		})
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/", nil)
		WeChatQRGenerate(c)
		var result struct {
			Success bool `json:"success"`
			Data    struct {
				QRURL       string `json:"qr_url"`
				RedirectURI string `json:"redirect_uri"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Success != valid {
			t.Fatal(w.Body.String())
		}
		_, exists := wechatStateStore.Load(state)
		wechatStateStore.Delete(state)
		if exists != valid {
			t.Fatalf("state retention = %v, valid = %v", exists, valid)
		}
		if valid && (result.Data.QRURL != "https://open.weixin.qq.com/connect/qrcode/test_uuid" || result.Data.RedirectURI != config.WeChatCallbackURL) {
			t.Fatal(w.Body.String())
		}
		if !valid && !strings.Contains(w.Body.String(), "微信二维码获取失败") {
			t.Fatal(w.Body.String())
		}
	}
}
