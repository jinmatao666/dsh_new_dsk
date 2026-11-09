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
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
)

func resourceRouter() *gin.Engine {
	r := gin.New()
	r.POST("/dsh-api/api/desktop-resources", UploadDesktopResources)
	r.GET("/dsh-api/api/desktop-resources/wheels/", ListDesktopWheels)
	r.GET("/dsh-api/api/desktop-resources/wheels/files/:bundle/:name", DownloadDesktopWheel)
	return r
}

func uploadResource(t *testing.T, r *gin.Engine, name string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write(content); err != nil {
		t.Fatal(err)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/dsh-api/api/desktop-resources", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	result := httptest.NewRecorder()
	r.ServeHTTP(result, req)
	return result
}

func TestDesktopResourceAppendCatalog(t *testing.T) {
	t.Setenv("DESKTOP_RESOURCE_DIR", t.TempDir())
	r := resourceRouter()
	base := resourceZIP(t, "humanize-4.0-py3-none-any.whl")
	for _, upload := range []struct {
		name string
		body []byte
	}{
		{"base.zip", base},
		{"extra.zip", resourceZIP(t, "humanize-4.0-py3-none-any.whl", "humanize-5.0-py3-none-any.whl")},
		{"base-again.zip", base},
	} {
		result := uploadResource(t, r, upload.name, upload.body)
		if result.Code != 200 {
			t.Fatalf("upload: %s", result.Body.String())
		}
	}
	catalog, err := currentOfflineBundle()
	if err != nil || len(catalog.Files) != 2 || len(catalog.Bundles) != 2 {
		t.Fatalf("catalog: %+v %v", catalog, err)
	}
	if catalog.Bundles[0].Name != "base.zip" || catalog.Bundles[1].Name != "extra.zip" {
		t.Fatal("upload names lost")
	}
	// Re-read the on-disk catalog and download every indexed artifact, including the original.
	index := httptest.NewRecorder()
	r.ServeHTTP(index, httptest.NewRequest("GET", "/dsh-api/api/desktop-resources/wheels/", nil))
	for _, file := range catalog.Files {
		link := "files/" + file.BundleID + "/" + file.Name
		if !strings.Contains(index.Body.String(), link+"#sha256="+file.SHA256) {
			t.Fatal("missing index link", link)
		}
		result := httptest.NewRecorder()
		r.ServeHTTP(result, httptest.NewRequest("GET", "/dsh-api/api/desktop-resources/wheels/"+link, nil))
		if result.Code != 200 || !bytes.HasPrefix(result.Body.Bytes(), []byte("PK")) {
			t.Fatal("download failed", link)
		}
	}
	before, _ := os.ReadFile(filepath.Join(desktopResourceRoot(), "catalog.json"))
	// Valid wheel with the same filename but different bytes must not replace the published catalog.
	conflict := append([]byte{}, testWheel(t)...)
	conflict = append(conflict, []byte("different archive comment")...)
	var data bytes.Buffer
	archive := zip.NewWriter(&data)
	file, _ := archive.Create("humanize-4.0-py3-none-any.whl")
	file.Write(conflict)
	archive.Close()
	result := uploadResource(t, r, "conflict.zip", data.Bytes())
	if result.Code != 400 || !strings.Contains(result.Body.String(), "冲突") {
		t.Fatalf("conflict: %s", result.Body.String())
	}
	after, _ := os.ReadFile(filepath.Join(desktopResourceRoot(), "catalog.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("failed upload changed catalog")
	}
	result = uploadResource(t, r, "broken.zip", []byte("broken"))
	if result.Code != 400 {
		t.Fatal("accepted malformed ZIP")
	}
	after, _ = os.ReadFile(filepath.Join(desktopResourceRoot(), "catalog.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("malformed upload changed catalog")
	}
}

func TestDesktopResourceAppendLegacyAndConcurrent(t *testing.T) {
	root := t.TempDir()
	t.Setenv("DESKTOP_RESOURCE_DIR", root)
	data := resourceZIP(t, "humanize-4.0-py3-none-any.whl")
	legacy, err := importOfflineBundle(bytes.NewReader(data), int64(len(data)), root)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "current"), []byte(legacy.ID), 0600); err != nil {
		t.Fatal(err)
	}
	r := resourceRouter()
	var wait sync.WaitGroup
	for _, version := range []string{"5.0", "6.0"} {
		data := resourceZIP(t, "humanize-"+version+"-py3-none-any.whl")
		wait.Add(1)
		go func() {
			defer wait.Done()
			result := uploadResource(t, r, "extra.zip", data)
			if result.Code != 200 {
				t.Errorf("upload: %s", result.Body.String())
			}
		}()
	}
	wait.Wait()
	catalog, err := currentOfflineBundle()
	if err != nil || len(catalog.Bundles) != 3 || len(catalog.Files) != 3 {
		t.Fatalf("lost upload or legacy bundle: %+v %v", catalog, err)
	}
}

func TestDesktopResourceAppendPipIntegration(t *testing.T) {
	python, err := exec.LookPath("python")
	if err != nil {
		t.Skip("Python not installed")
	}
	t.Setenv("DESKTOP_RESOURCE_DIR", t.TempDir())
	r := resourceRouter()
	base := resourceZIP(t, "humanize-4.0-py3-none-any.whl")
	// Supplement requires a dependency that exists only in the earlier base upload.
	var wheel bytes.Buffer
	w := zip.NewWriter(&wheel)
	for name, content := range map[string]string{
		"supplement/__init__.py":            "import humanize\nvalue = humanize.__version__\n",
		"supplement-1.0.dist-info/METADATA": "Metadata-Version: 2.1\nName: supplement\nVersion: 1.0\nRequires-Dist: humanize==4.0\n",
		"supplement-1.0.dist-info/WHEEL":    "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
		"supplement-1.0.dist-info/RECORD":   "",
	} {
		f, e := w.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = f.Write([]byte(content)); e != nil {
			t.Fatal(e)
		}
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	var supplement bytes.Buffer
	z := zip.NewWriter(&supplement)
	f, err := z.Create("supplement-1.0-py3-none-any.whl")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(wheel.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = z.Close(); err != nil {
		t.Fatal(err)
	}
	for _, data := range [][]byte{base, supplement.Bytes()} {
		result := uploadResource(t, r, "dependencies.zip", data)
		if result.Code != 200 {
			t.Fatal(result.Body.String())
		}
	}
	server := httptest.NewServer(r)
	defer server.Close()
	target := t.TempDir()
	command := exec.Command(python, "-m", "pip", "install", "--ignore-installed", "--no-cache-dir", "--disable-pip-version-check", "--target", target, "supplement==1.0")
	command.Env = append(os.Environ(), "PIP_CONFIG_FILE="+os.DevNull, "PIP_PROXY=", "HTTP_PROXY=http://127.0.0.1:9", "HTTPS_PROXY=http://127.0.0.1:9", "ALL_PROXY=http://127.0.0.1:9", "NO_PROXY=127.0.0.1", "PIP_EXTRA_INDEX_URL=", "PIP_NO_INDEX=1", "PIP_FIND_LINKS="+server.URL+"/dsh-api/api/desktop-resources/wheels/", "PIP_INDEX_URL=")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("offline pip: %v\n%s", err, output)
	}
	script := "import sys; sys.path.insert(0, " + string(mustJSON(t, target)) + "); import supplement; assert supplement.value == '4.0'; print('base and supplement imported')"
	if output, err := exec.Command(python, "-I", "-c", script).CombinedOutput(); err != nil {
		t.Fatalf("import: %v\n%s", err, output)
	}
}

func mustJSON(t *testing.T, value string) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// Opt-in acceptance uses the exact delivery ZIP without embedding a large fixture in Git.
func TestDesktopResourceDeliveryArchive(t *testing.T) {
	path := os.Getenv("DSH_OFFLINE_TEST_ZIP")
	if path == "" {
		t.Skip("set DSH_OFFLINE_TEST_ZIP to the delivery ZIP")
	}
	python, err := exec.LookPath("python")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("DESKTOP_RESOURCE_DIR", t.TempDir())
	body, err := os.CreateTemp(t.TempDir(), "multipart-*")
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	form := multipart.NewWriter(body)
	part, err := form.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		t.Fatal(err)
	}
	archive, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, copyErr := io.Copy(part, archive)
	archive.Close()
	if copyErr != nil {
		t.Fatal(copyErr)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = body.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	r := resourceRouter()
	request := httptest.NewRequest("POST", "/dsh-api/api/desktop-resources", body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	response := httptest.NewRecorder()
	r.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	response = uploadResource(t, r, "supplement.zip", resourceZIP(t, "humanize-4.0-py3-none-any.whl"))
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	catalog, err := currentOfflineBundle()
	if err != nil || len(catalog.Bundles) != 2 {
		t.Fatalf("catalog: %+v %v", catalog, err)
	}
	t.Logf("Delivery ZIP + supplement: %d packages, %d files", len(catalog.Bundles), len(catalog.Files))
	server := httptest.NewServer(r)
	defer server.Close()
	target := t.TempDir()
	command := exec.Command(python, "-m", "pip", "install", "--ignore-installed", "--no-cache-dir", "--disable-pip-version-check", "--target", target, "openpyxl", "humanize==4.0")
	command.Env = append(os.Environ(), "PIP_CONFIG_FILE="+os.DevNull, "PIP_PROXY=", "HTTP_PROXY=http://127.0.0.1:9", "HTTPS_PROXY=http://127.0.0.1:9", "ALL_PROXY=http://127.0.0.1:9", "NO_PROXY=127.0.0.1", "PIP_EXTRA_INDEX_URL=", "PIP_NO_INDEX=1", "PIP_FIND_LINKS="+server.URL+"/dsh-api/api/desktop-resources/wheels/", "PIP_INDEX_URL=")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("delivery pip: %v\n%s", err, output)
	} else {
		t.Log(string(output))
	}
	script := "import sys; sys.path.insert(0, " + string(mustJSON(t, target)) + "); import openpyxl, humanize; w=openpyxl.Workbook(); w.active['A1']='offline'; assert w.active['A1'].value == 'offline'; assert humanize.__version__ == '4.0'; print('workbook and supplement OK')"
	if output, err := exec.Command(python, "-I", "-c", script).CombinedOutput(); err != nil {
		t.Fatalf("delivery import: %v\n%s", err, output)
	} else {
		t.Log(string(output))
	}
}
