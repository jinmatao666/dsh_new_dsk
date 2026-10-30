package controller_test

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/songquanpeng/one-api/common/deployment"
	"github.com/stretchr/testify/require"
)

func TestDesktopRuntimeDeploymentUpdateDownload(t *testing.T) {
	r, key, _ := updateRouter(t)
	id := uploadedID(t, requestUpdate(t, r, "POST", "/api/desktop-updates", "root", updateZIP(t, key, "1.2.0", "windows-x86_64", false)))
	require.Equal(t, 200, requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/publish", "root", nil).Code)
	previous := deployment.Current
	t.Cleanup(func() { deployment.Current = previous })
	for _, prefix := range []string{"", "/dsh-api", "/unit/service"} {
		deployment.Current = deployment.Settings{APIPrefix: prefix, PublicURL: "https://external.example" + prefix}
		h := deployment.Current.Handler(r)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "http://internal:3000"+prefix+"/desktop-updates/windows/x86_64/1.0.0", nil))
		require.Equal(t, 200, w.Code)
		var body map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, "https://external.example"+prefix+"/desktop-updates/files/"+id, body["url"])
		require.Equal(t, "desktop-updates/files/"+id, body["download_path"])
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", body["url"].(string), nil))
		require.Equal(t, 200, w.Code)
		require.Equal(t, "test-only signed installer", w.Body.String())
	}
}

func TestWebsiteInstallerRuntimeDeploymentPublicDownload(t *testing.T) {
	r, _ := installerRouter(t)
	id := uploadedID(t, installerUpload(t, r, "root", "1.2.3", "windows-x64", "original.exe", installerPE()))
	require.Equal(t, 200, installerAction(r, id, "publish").Code)
	previous := deployment.Current
	t.Cleanup(func() { deployment.Current = previous })
	deployment.Current = deployment.Settings{APIPrefix: "/unit/api", PublicURL: "https://external.example/unit/api"}
	h := deployment.Current.Handler(r)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/unit/api/api/website-installers", nil))
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), "https://external.example/unit/api/downloads/installers/"+id)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "https://external.example/unit/api/downloads/installers/"+id, nil))
	require.Equal(t, 200, w.Code)
	require.Equal(t, installerPE(), w.Body.Bytes())
}
