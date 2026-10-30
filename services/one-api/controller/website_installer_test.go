package controller_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/controller"
	"github.com/songquanpeng/one-api/middleware"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
)

func installerRouter(t *testing.T) (*gin.Engine, string) {
	r, _, root := updateRouter(t)
	require.NoError(t, model.DB.AutoMigrate(&model.WebsiteInstaller{}, &model.WebsiteInstallerChannel{}))
	admin := r.Group("/api/admin/website-installers", middleware.RootAuth())
	admin.GET("", controller.AdminListWebsiteInstallers)
	admin.POST("", controller.AdminUploadWebsiteInstaller)
	admin.POST("/:id/:action", controller.AdminChangeWebsiteInstaller)
	admin.DELETE("/:id", controller.AdminChangeWebsiteInstaller)
	r.GET("/api/website-installers", controller.PublicWebsiteInstallers)
	r.GET("/downloads/installers/:id", controller.DownloadWebsiteInstaller)
	r.HEAD("/downloads/installers/:id", controller.DownloadWebsiteInstaller)
	return r, root
}

func updateRequest(r *gin.Engine, method, path string, body []byte, contentType, role string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if role != "" {
		login := httptest.NewRecorder()
		r.ServeHTTP(login, httptest.NewRequest("GET", "/login/"+role, nil))
		for _, cookie := range login.Result().Cookies() {
			req.AddCookie(cookie)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func installerPE() []byte {
	data := make([]byte, 256)
	copy(data, "MZ")
	binary.LittleEndian.PutUint32(data[0x3c:], 64)
	copy(data[64:], "PE\x00\x00")
	binary.LittleEndian.PutUint16(data[68:], 0x8664)
	binary.LittleEndian.PutUint16(data[86:], 2)
	return data
}
func installerDMG() []byte { data := make([]byte, 1024); copy(data[512:], "koly"); return data }
func installerUpload(t *testing.T, r *gin.Engine, role, version, platform, name string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("version", version))
	require.NoError(t, writer.WriteField("platform", platform))
	require.NoError(t, writer.WriteField("notes", "安装说明"))
	part, err := writer.CreateFormFile("file", name)
	require.NoError(t, err)
	_, err = part.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return updateRequest(r, "POST", "/api/admin/website-installers", body.Bytes(), writer.FormDataContentType(), role)
}
func installerAction(r *gin.Engine, id, action string) *httptest.ResponseRecorder {
	method, path := "POST", "/api/admin/website-installers/"+id+"/"+action
	if action == "delete" {
		method, path = "DELETE", "/api/admin/website-installers/"+id
	}
	return updateRequest(r, method, path, nil, "", "root")
}
func installerCatalog(t *testing.T, r *gin.Engine) []map[string]interface{} {
	t.Helper()
	w := updateRequest(r, "GET", "/api/website-installers", nil, "", "")
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	var data struct {
		Packages []map[string]interface{} `json:"packages"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &data))
	require.NotNil(t, data.Packages)
	return data.Packages
}

func TestWebsiteInstallerLifecycle(t *testing.T) {
	r, root := installerRouter(t)
	// Existing updater artifacts stay outside the new subdirectory.
	sentinel := filepath.Join(root, "existing-updater")
	require.NoError(t, os.WriteFile(sentinel, []byte("unchanged"), 0600))
	for _, role := range []string{"", "common"} {
		w := installerUpload(t, r, role, "1.2.3", "windows-x64", "app.exe", installerPE())
		var response map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, false, response["success"])
		w = updateRequest(r, "GET", "/api/admin/website-installers", nil, "", role)
		require.Contains(t, w.Body.String(), `"success":false`)
	}
	data := installerPE()
	id := uploadedID(t, installerUpload(t, r, "root", "1.2.3", "windows-x64", "original.exe", data))
	stored := filepath.Join(root, "website-installers", id, "installer")
	actual, err := os.ReadFile(stored)
	require.NoError(t, err)
	require.Equal(t, data, actual)
	require.Empty(t, installerCatalog(t, r))
	require.Equal(t, 404, updateRequest(r, "GET", "/downloads/installers/"+id, nil, "", "").Code)
	for _, role := range []string{"", "common"} {
		require.Contains(t, updateRequest(r, "POST", "/api/admin/website-installers/"+id+"/publish", nil, "", role).Body.String(), `"success":false`)
		require.Contains(t, updateRequest(r, "DELETE", "/api/admin/website-installers/"+id, nil, "", role).Body.String(), `"success":false`)
	}
	w := installerAction(r, id, "publish")
	require.Equal(t, 200, w.Code, w.Body.String())
	packages := installerCatalog(t, r)
	require.Len(t, packages, 1)
	hash := sha256.Sum256(data)
	require.Equal(t, hex.EncodeToString(hash[:]), packages[0]["sha256"])
	require.Equal(t, "1.2.3", packages[0]["version"])
	require.NotContains(t, packages[0], "created_by")
	require.NotContains(t, packages[0], "path")
	url := packages[0]["url"].(string)
	require.Equal(t, "/downloads/installers/"+id, url)
	w = updateRequest(r, "GET", url, nil, "", "")
	require.Equal(t, 200, w.Code)
	require.Equal(t, data, w.Body.Bytes())
	require.Contains(t, w.Header().Get("Content-Disposition"), "WanweiBuddy-1.2.3-windows-x64.exe")
	w = updateRequest(r, "HEAD", url, nil, "", "")
	require.Equal(t, 200, w.Code)
	require.Empty(t, w.Body.Bytes())
	require.Equal(t, "256", w.Header().Get("Content-Length"))
	req := httptest.NewRequest("GET", url, nil)
	req.Header.Set("Range", "bytes=0-15")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusPartialContent, w.Code)
	require.Equal(t, data[:16], w.Body.Bytes())
	require.Equal(t, 400, installerAction(r, id, "delete").Code)
	require.Equal(t, 200, installerAction(r, id, "withdraw").Code)
	require.Empty(t, installerCatalog(t, r))
	require.Equal(t, 404, updateRequest(r, "GET", url, nil, "", "").Code)
	require.Equal(t, 200, installerAction(r, id, "delete").Code)
	_, err = os.Stat(stored)
	require.True(t, os.IsNotExist(err))
	require.Equal(t, 400, installerAction(r, id, "publish").Code)
	actual, err = os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "unchanged", string(actual))
}

func TestWebsiteInstallerReplacementAndArchitectures(t *testing.T) {
	r, _ := installerRouter(t)
	first := uploadedID(t, installerUpload(t, r, "root", "1.0.0", "windows-x64", "a.exe", installerPE()))
	second := uploadedID(t, installerUpload(t, r, "root", "1.0.0", "windows-x64", "b.exe", installerPE()))
	arm := uploadedID(t, installerUpload(t, r, "root", "2.0.0", "macos-arm64", "arm.dmg", installerDMG()))
	intel := uploadedID(t, installerUpload(t, r, "root", "1.5.0", "macos-x64", "intel.dmg", installerDMG()))
	for _, id := range []string{first, arm, intel, second} {
		require.Equal(t, 200, installerAction(r, id, "publish").Code)
	}
	packages := installerCatalog(t, r)
	require.Len(t, packages, 3)
	require.Equal(t, 404, updateRequest(r, "GET", "/downloads/installers/"+first, nil, "", "").Code)
	require.Equal(t, 400, installerAction(r, first, "withdraw").Code)
	require.Equal(t, 200, installerAction(r, first, "delete").Code)
	require.Equal(t, 200, installerAction(r, second, "withdraw").Code)
	packages = installerCatalog(t, r)
	require.Len(t, packages, 2)
	for _, item := range packages {
		require.Equal(t, "macos", item["platform"])
	}
	// A publication survives a fresh query/handler instance, rather than residing only in memory.
	var channels []model.WebsiteInstallerChannel
	require.NoError(t, model.DB.Find(&channels).Error)
	require.Len(t, channels, 3)
	w := updateRequest(r, "GET", "/api/admin/website-installers", nil, "", "root")
	require.Contains(t, w.Body.String(), `"max_bytes":`)
}

func TestWebsiteInstallerInvalidAndTamperedUploads(t *testing.T) {
	r, root := installerRouter(t)
	x86 := installerPE()
	binary.LittleEndian.PutUint16(x86[68:], 0x14c)
	for _, item := range []struct {
		version, platform, name string
		data                    []byte
	}{
		{"1.0.0", "windows-arm64", "a.exe", installerPE()}, {"1.0.0", "linux-x64", "a.exe", installerPE()},
		{"invalid", "windows-x64", "a.exe", installerPE()}, {"1.0.0-beta.1", "windows-x64", "a.exe", installerPE()},
		{"1.0.0", "macos-x64", "a.zip", installerDMG()}, {"1.0.0", "macos-arm64", "a.dmg", []byte("PK zip")},
		{"1.0.0", "windows-x64", "a.exe", []byte("PK zip")}, {"1.0.0", "windows-x64", "a.exe", x86},
		{"1.0.0", "windows-x64", "a.exe", nil},
	} {
		w := installerUpload(t, r, "root", item.version, item.platform, item.name, item.data)
		require.Equal(t, 400, w.Code, w.Body.String())
	}
	t.Setenv("DESKTOP_UPDATE_MAX_BYTES", "1024")
	oversize := append(installerPE(), make([]byte, 1025)...)
	require.Equal(t, 400, installerUpload(t, r, "root", "1.0.0", "windows-x64", "a.exe", oversize).Code)
	var count int64
	require.NoError(t, model.DB.Model(&model.WebsiteInstaller{}).Count(&count).Error)
	require.Zero(t, count)
	entries, err := os.ReadDir(filepath.Join(root, "website-installers"))
	require.NoError(t, err)
	require.Empty(t, entries)
	id := uploadedID(t, installerUpload(t, r, "root", "1.0.0", "windows-x64", "../../traversal.exe", installerPE()))
	path := filepath.Join(root, "website-installers", id, "installer")
	file, err := os.OpenFile(path, os.O_WRONLY, 0600)
	require.NoError(t, err)
	_, err = file.WriteAt([]byte("bad"), 0)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	require.Equal(t, 400, installerAction(r, id, "publish").Code)
	require.Empty(t, installerCatalog(t, r))
	require.NoError(t, os.Remove(path))
	require.Equal(t, 400, installerAction(r, id, "publish").Code)
	require.Equal(t, 200, installerAction(r, id, "delete").Code)
	for _, id := range []string{"not-an-id", "..", "abcd"} {
		require.Equal(t, 404, updateRequest(r, "GET", "/downloads/installers/"+id, nil, "", "").Code)
	}
}
