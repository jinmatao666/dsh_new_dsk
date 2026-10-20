package controller

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func resourceZIP(t *testing.T, names ...string) []byte {
	t.Helper()
	var data bytes.Buffer
	writer := zip.NewWriter(&data)
	for _, name := range names {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(name, "/") {
			continue
		}
		if _, err := file.Write(testWheel(t)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func testWheel(t *testing.T) []byte {
	t.Helper()
	var body bytes.Buffer
	writer := zip.NewWriter(&body)
	for name, content := range map[string]string{
		"humanize/__init__.py":            "__version__ = '4.0'\n",
		"humanize-4.0.dist-info/METADATA": "Metadata-Version: 2.1\nName: humanize\nVersion: 4.0\n",
		"humanize-4.0.dist-info/WHEEL":    "Wheel-Version: 1.0\nGenerator: test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
		"humanize-4.0.dist-info/RECORD":   "",
	} {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes()
}

func TestDesktopResourceSettings(t *testing.T) {
	for _, resources := range []string{
		`null`, `{}`, `{"source":"offline","proxyUrl":"","autoDetect":null,"probeUrls":[]}`,
		`{"source":"proxy","proxyUrl":"http://user:secret@relay:3128","autoDetect":false,"probeUrls":[]}`,
		`{"source":"proxy","proxyUrl":"http://relay:3128/path","autoDetect":false,"probeUrls":[]}`,
		`{"source":"proxy","proxyUrl":"http://relay:3128","autoDetect":true,"probeUrls":[]}`,
	} {
		if _, err := parseDesktopDeploymentSettings(`{"network":"intranet","resources":` + resources + `}`); err == nil {
			t.Fatalf("accepted %s", resources)
		}
	}
	settings, err := parseDesktopDeploymentSettings(`{"network":"intranet","resources":{"source":"offline","proxyUrl":"","autoDetect":false,"probeUrls":[]}}`)
	if err != nil || settings.Resources.Source != "offline" {
		t.Fatalf("%+v %v", settings, err)
	}
}

func TestDesktopResourceArchiveValidation(t *testing.T) {
	for _, names := range [][]string{{"../escape.whl"}, {"folder/x.whl"}, {"script.py"}, {"x.whl", "X.whl"}, {"folder/"}} {
		data := resourceZIP(t, names...)
		if _, err := importOfflineBundle(bytes.NewReader(data), int64(len(data)), t.TempDir()); err == nil {
			t.Fatalf("accepted %v", names)
		}
	}
}

func TestDesktopResourceUploadAndDownload(t *testing.T) {
	root := t.TempDir()
	t.Setenv("DESKTOP_RESOURCE_DIR", root)
	r := gin.New()
	r.POST("/api/desktop-resources", UploadDesktopResources)
	r.GET("/api/desktop-resources", GetDesktopResources)
	r.GET("/api/desktop-resources/wheels/", ListDesktopWheels)
	r.GET("/api/desktop-resources/wheels/files/:bundle/:name", DownloadDesktopWheel)
	for attempt := 0; attempt < 2; attempt++ {
		var data bytes.Buffer
		form := multipart.NewWriter(&data)
		file, err := form.CreateFormFile("file", "dependencies.zip")
		if err != nil {
			t.Fatal(err)
		}
		_, err = file.Write(resourceZIP(t, "humanize-4.0-py3-none-any.whl"))
		if err != nil {
			t.Fatal(err)
		}
		form.Close()
		req := httptest.NewRequest("POST", "/api/desktop-resources", &data)
		req.Header.Set("Content-Type", form.FormDataContentType())
		response := httptest.NewRecorder()
		r.ServeHTTP(response, req)
		if response.Code != 200 {
			t.Fatalf("upload: %d %s", response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest("GET", "/api/desktop-resources", nil))
	var body struct {
		Data offlineBundle `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data.Files) != 1 || len(body.Data.Files[0].SHA256) != 64 {
		t.Fatalf("metadata: %+v", body)
	}
	response = httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest("GET", "/api/desktop-resources/wheels/", nil))
	if !strings.Contains(response.Body.String(), "#sha256="+body.Data.Files[0].SHA256) {
		t.Fatal("missing wheel integrity hash")
	}
	response = httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest("GET", "/api/desktop-resources/wheels/files/"+body.Data.ID+"/humanize-4.0-py3-none-any.whl", nil))
	content, _ := io.ReadAll(response.Result().Body)
	if !bytes.HasPrefix(content, []byte("PK")) {
		t.Fatalf("download: %s", content)
	}
	entries, _ := os.ReadDir(root)
	for _, entry := range entries {
		if strings.HasPrefix(filepath.Base(entry.Name()), ".") {
			t.Fatal("temporary upload leaked")
		}
	}
}

func TestDesktopResourcePipIntegration(t *testing.T) {
	python, err := exec.LookPath("python")
	if err != nil {
		t.Skip("Python not installed")
	}
	root := t.TempDir()
	t.Setenv("DESKTOP_RESOURCE_DIR", root)
	data := resourceZIP(t, "humanize-4.0-py3-none-any.whl")
	bundle, err := importOfflineBundle(bytes.NewReader(data), int64(len(data)), root)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "current"), []byte(bundle.ID), 0600); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.GET("/api/desktop-resources/wheels/", ListDesktopWheels)
	r.GET("/api/desktop-resources/wheels/files/:bundle/:name", DownloadDesktopWheel)
	server := httptest.NewServer(r)
	defer server.Close()
	target := t.TempDir()
	command := exec.Command(python, "-m", "pip", "install", "--no-deps", "--disable-pip-version-check", "--target", target, "humanize==4.0")
	command.Env = append(os.Environ(), "PIP_CONFIG_FILE="+os.DevNull, "PIP_PROXY=", "HTTP_PROXY=http://127.0.0.1:9", "HTTPS_PROXY=http://127.0.0.1:9", "ALL_PROXY=http://127.0.0.1:9", "NO_PROXY=127.0.0.1", "PIP_EXTRA_INDEX_URL=", "PIP_NO_INDEX=1", "PIP_FIND_LINKS="+server.URL+"/api/desktop-resources/wheels/", "PIP_INDEX_URL=")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("pip integration: %v\n%s", err, output)
	}
	if _, err = os.Stat(filepath.Join(target, "humanize", "__init__.py")); err != nil {
		t.Fatal(err)
	}
}
