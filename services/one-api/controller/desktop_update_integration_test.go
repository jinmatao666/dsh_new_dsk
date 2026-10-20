package controller_test

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"aead.dev/minisign"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/controller"
	"github.com/songquanpeng/one-api/middleware"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

func updateRouter(t *testing.T) (*gin.Engine, minisign.PrivateKey, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "updates.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.DesktopUpdate{}, &model.DesktopUpdateChannel{}); err != nil {
		t.Fatal(err)
	}
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old; sql, _ := db.DB(); _ = sql.Close() })
	root := t.TempDir()
	t.Setenv("DESKTOP_UPDATE_DIR", root)
	t.Setenv("DESKTOP_UPDATE_PUBLIC_URL", "http://updates.example:3300")
	pub, private, err := minisign.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	key, err := pub.MarshalText()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("DESKTOP_UPDATE_PUBLIC_KEY", base64.StdEncoding.EncodeToString(key))
	r := gin.New()
	r.Use(sessions.Sessions("update-test", cookie.NewStore([]byte("test-only-session-secret-32-bytes"))))
	r.GET("/login/:role", func(c *gin.Context) {
		role := model.RoleCommonUser
		if c.Param("role") == "root" {
			role = model.RoleRootUser
		}
		session := sessions.Default(c)
		session.Set("username", "tester")
		session.Set("id", 1)
		session.Set("status", model.UserStatusEnabled)
		session.Set("role", role)
		if err := session.Save(); err != nil {
			t.Error(err)
		}
		c.Status(200)
	})
	admin := r.Group("/api/desktop-updates", middleware.RootAuth())
	admin.GET("", controller.AdminListDesktopUpdates)
	admin.POST("", controller.AdminUploadDesktopUpdate)
	admin.POST("/:id/publish", controller.AdminPublishDesktopUpdate)
	admin.POST("/:id/withdraw", controller.AdminWithdrawDesktopUpdate)
	r.GET("/desktop-updates/files/:id", controller.DownloadDesktopUpdate)
	r.GET("/desktop-updates/:target/:arch/:current", controller.CheckDesktopUpdate)
	return r, private, root
}

func signedText(t *testing.T, key minisign.PrivateKey, content []byte) string {
	t.Helper()
	r := minisign.NewReader(bytes.NewReader(content))
	if _, err := io.Copy(io.Discard, r); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(r.Sign(key))
}

func updateZIP(t *testing.T, key minisign.PrivateKey, version, platform string, tamper bool) []byte {
	t.Helper()
	content := []byte("test-only signed installer")
	hash := sha256.Sum256(content)
	name := "update.exe"
	if platform != "windows-x86_64" {
		name = "update.app.tar.gz"
	}
	manifest := map[string]interface{}{"schema": 1, "product": "com.wanwei.harness", "version": version, "platform": platform, "file": name, "size": len(content), "sha256": hex.EncodeToString(hash[:]), "signature": signedText(t, key, content)}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	signature := signedText(t, key, data)
	if tamper {
		data = bytes.ReplaceAll(data, []byte(version), []byte("9.9.9"))
	}
	var out bytes.Buffer
	z := zip.NewWriter(&out)
	for file, value := range map[string][]byte{"release.json": data, "release.json.sig": []byte(signature), name: content} {
		w, err := z.Create(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(value); err != nil {
			t.Fatal(err)
		}
	}
	if err = z.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func requestUpdate(t *testing.T, r *gin.Engine, method, path, role string, archive []byte, overrides ...map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	contentType := ""
	if archive != nil {
		m := multipart.NewWriter(&body)
		file, err := m.CreateFormFile("file", "release.zip")
		if err != nil {
			t.Fatal(err)
		}
		file.Write(archive)
		m.WriteField("notes", "更新说明")
		fields := map[string]string{"version": "1.2.0", "platform": "windows-x86_64"}
		if z, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive))); err == nil {
			for _, entry := range z.File {
				if entry.Name != "release.json" {
					continue
				}
				reader, err := entry.Open()
				if err != nil {
					t.Fatal(err)
				}
				var manifest struct {
					Version  string `json:"version"`
					Platform string `json:"platform"`
				}
				err = json.NewDecoder(reader).Decode(&manifest)
				reader.Close()
				if err == nil {
					fields["version"] = manifest.Version
					fields["platform"] = manifest.Platform
				}
			}
		}
		for _, values := range overrides {
			for key, value := range values {
				fields[key] = value
			}
		}
		for key, value := range fields {
			m.WriteField(key, value)
		}
		m.Close()
		contentType = m.FormDataContentType()
	}
	req := httptest.NewRequest(method, path, &body)
	if role != "" {
		login := httptest.NewRecorder()
		r.ServeHTTP(login, httptest.NewRequest("GET", "/login/"+role, nil))
		for _, cookie := range login.Result().Cookies() {
			req.AddCookie(cookie)
		}
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func uploadedID(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var result struct {
		Success bool
		Data    struct{ ID string }
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != 200 || !result.Success || result.Data.ID == "" {
		t.Fatalf("upload failed: %d %s", w.Code, w.Body.String())
	}
	return result.Data.ID
}

func TestDesktopUpdateDeclaredMetadataMustMatchSignature(t *testing.T) {
	r, key, root := updateRouter(t)
	bundle := updateZIP(t, key, "1.2.0", "darwin-aarch64", false)
	for name, fields := range map[string]map[string]string{
		"missing-version":    {"version": ""},
		"invalid-version":    {"version": "v1.2.0"},
		"relabelled-version": {"version": "2.0.0"},
		"wrong-architecture": {"platform": "darwin-x86_64"},
		"missing-platform":   {"platform": ""},
	} {
		t.Run(name, func(t *testing.T) {
			w := requestUpdate(t, r, "POST", "/api/desktop-updates", "root", bundle, fields)
			var result struct {
				Success bool `json:"success"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Success {
				t.Fatal("mismatched metadata accepted")
			}
		})
	}
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 0 {
		t.Fatalf("rejected metadata left files: %v", err)
	}
	uploadedID(t, requestUpdate(t, r, "POST", "/api/desktop-updates", "root", bundle))
}

func TestDesktopUpdateLifecycle(t *testing.T) {
	r, key, root := updateRouter(t)
	bundle := updateZIP(t, key, "1.2.0", "windows-x86_64", false)
	for _, role := range []string{"", "user"} {
		w := requestUpdate(t, r, "POST", "/api/desktop-updates", role, bundle)
		if w.Code == 200 && bytes.Contains(w.Body.Bytes(), []byte(`"success":true`)) {
			t.Fatal("non-root upload allowed")
		}
	}
	id := uploadedID(t, requestUpdate(t, r, "POST", "/api/desktop-updates", "root", bundle))
	if w := requestUpdate(t, r, "GET", "/desktop-updates/windows/x86_64/1.0.0", "", nil); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := requestUpdate(t, r, "GET", "/desktop-updates/files/"+id, "", nil); w.Code != 404 {
		t.Fatal("draft publicly downloadable")
	}
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/publish", "user", nil); bytes.Contains(w.Body.Bytes(), []byte(`"success":true`)) {
		t.Fatal("non-root publication allowed")
	}
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/publish", "root", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w := requestUpdate(t, r, "GET", "/desktop-updates/windows/x86_64/1.0.0", "", nil)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || !bytes.Contains(w.Body.Bytes(), []byte(`"download_path":"desktop-updates/files/`+id+`"`)) {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, path := range []string{"/desktop-updates/windows/x86_64/1.2.0", "/desktop-updates/windows/x86_64/2.0.0", "/desktop-updates/darwin/aarch64/1.0.0"} {
		if w := requestUpdate(t, r, "GET", path, "", nil); w.Code != 204 {
			t.Fatal(path, w.Code)
		}
	}
	if w := requestUpdate(t, r, "GET", "/desktop-updates/files/"+id, "", nil); w.Code != 200 || w.Body.String() != "test-only signed installer" {
		t.Fatal("download failed")
	}
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates", "root", bundle); w.Code == 200 {
		t.Fatal("duplicate version accepted")
	}
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/withdraw", "root", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := requestUpdate(t, r, "GET", "/desktop-updates/windows/x86_64/1.0.0", "", nil); w.Code != 204 {
		t.Fatal("withdrawal fell back")
	}
	older := uploadedID(t, requestUpdate(t, r, "POST", "/api/desktop-updates", "root", updateZIP(t, key, "1.1.0", "windows-x86_64", false)))
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+older+"/publish", "root", nil); w.Code == 200 {
		t.Fatal("downgrade allowed")
	}
	if err := os.WriteFile(filepath.Join(root, id, "artifact"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/publish", "root", nil); w.Code == 200 {
		t.Fatal("publish did not reverify")
	}
}

func TestDesktopUpdateDownloadUsesConnectedBackendWithoutPublicURL(t *testing.T) {
	r, key, _ := updateRouter(t)
	id := uploadedID(t, requestUpdate(t, r, "POST", "/api/desktop-updates", "root", updateZIP(t, key, "1.2.0", "windows-x86_64", false)))
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/publish", "root", nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	for _, address := range []string{"", "https://unreachable.example", "invalid-old-setting"} {
		t.Setenv("DESKTOP_UPDATE_PUBLIC_URL", address)
		t.Setenv("SERVER_ADDRESS", address)
		for _, base := range []string{"http://192.168.1.100:3300", "http://ac.zjugis.com:3300", "https://backend.internal"} {
			req := httptest.NewRequest("GET", base+"/desktop-updates/windows/x86_64/1.0.0", nil)
			req.Header.Set("X-Forwarded-Host", "foreign.example")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			var response map[string]interface{}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != 200 {
				t.Fatal(w.Code, w.Body.String(), err)
			}
			if response["download_path"] != "desktop-updates/files/"+id || response["url"] != base+"/desktop-updates/files/"+id {
				t.Fatal("download did not use request backend", response)
			}
			// Follow the returned relative path through the same backend entry.
			download := httptest.NewRecorder()
			r.ServeHTTP(download, httptest.NewRequest("GET", base+"/"+response["download_path"].(string), nil))
			if download.Code != 200 || download.Body.String() != "test-only signed installer" {
				t.Fatal("same-backend artifact download failed", download.Code)
			}
		}
	}
}

func TestDesktopUpdateArchitecturesPublishIndependently(t *testing.T) {
	r, key, _ := updateRouter(t)
	ids := map[string]string{}
	for _, arch := range []string{"x86_64", "aarch64"} {
		id := uploadedID(t, requestUpdate(t, r, "POST", "/api/desktop-updates", "root", updateZIP(t, key, "1.2.0", "darwin-"+arch, false)))
		ids[arch] = id
		w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/publish", "root", nil)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	for arch, id := range ids {
		w := requestUpdate(t, r, "GET", "/desktop-updates/darwin/"+arch+"/1.0.0", "", nil)
		if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("/files/"+id)) {
			t.Fatalf("wrong package for %s: %s", arch, w.Body.String())
		}
	}
	requestUpdate(t, r, "POST", "/api/desktop-updates/"+ids["x86_64"]+"/withdraw", "root", nil)
	if w := requestUpdate(t, r, "GET", "/desktop-updates/darwin/aarch64/1.0.0", "", nil); w.Code != 200 {
		t.Fatal("withdrawing x64 affected ARM64")
	}
}

func TestDesktopUpdateRejectsUnsafeBundles(t *testing.T) {
	r, key, root := updateRouter(t)
	_, wrong, _ := minisign.GenerateKey(nil)
	for name, bundle := range map[string][]byte{"wrong-key": updateZIP(t, wrong, "1.2.0", "windows-x86_64", false), "relabelled": updateZIP(t, key, "1.2.0", "windows-x86_64", true), "prerelease": updateZIP(t, key, "1.2.0-beta.1", "windows-x86_64", false), "platform": updateZIP(t, key, "1.2.0", "unknown", false), "not-zip": []byte("installer")} {
		t.Run(name, func(t *testing.T) {
			if w := requestUpdate(t, r, "POST", "/api/desktop-updates", "root", bundle); w.Code == 200 {
				t.Fatal("invalid upload accepted")
			}
		})
	}
	t.Setenv("DESKTOP_UPDATE_PUBLIC_KEY", "")
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates", "root", updateZIP(t, key, "1.2.0", "windows-x86_64", false)); w.Code == 200 {
		t.Fatal("missing key accepted")
	}
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 0 {
		t.Fatal("failed uploads left artifacts", err)
	}
}

func TestDesktopUpdateRejectsArchivePathsAndSize(t *testing.T) {
	r, key, _ := updateRouter(t)
	valid := updateZIP(t, key, "1.2.0", "windows-x86_64", false)
	for _, attack := range []string{"../artifact", "duplicate", "extra", "corrupt-artifact"} {
		t.Run(attack, func(t *testing.T) {
			original, err := zip.NewReader(bytes.NewReader(valid), int64(len(valid)))
			if err != nil {
				t.Fatal(err)
			}
			var modified bytes.Buffer
			writer := zip.NewWriter(&modified)
			for _, entry := range original.File {
				name := entry.Name
				if attack == "../artifact" && name == "update.exe" {
					name = "../artifact"
				}
				out, err := writer.Create(name)
				if err != nil {
					t.Fatal(err)
				}
				input, err := entry.Open()
				if err != nil {
					t.Fatal(err)
				}
				if attack == "corrupt-artifact" && name == "update.exe" {
					_, err = out.Write([]byte("changed"))
				} else {
					_, err = io.Copy(out, input)
				}
				input.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			if attack == "duplicate" || attack == "extra" {
				name := "extra"
				if attack == "duplicate" {
					name = "release.json"
				}
				if _, err := writer.Create(name); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			if w := requestUpdate(t, r, "POST", "/api/desktop-updates", "root", modified.Bytes()); w.Code == 200 {
				t.Fatal("unsafe ZIP accepted")
			}
		})
	}
	t.Setenv("DESKTOP_UPDATE_MAX_BYTES", "not-a-number")
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates", "root", valid); w.Code == 200 {
		t.Fatal("invalid limit silently defaulted")
	}
}

// The Node packaging test invokes this with temporary real Tauri CLI signatures, never production keys.
func TestDesktopUpdateTauriInterop(t *testing.T) {
	path := os.Getenv("DSH_UPDATE_TEST_ZIP")
	if path == "" {
		t.Skip("run products/wanwei-desktop/scripts/package-update.test.mjs for real Tauri interop")
	}
	r, _, _ := updateRouter(t)
	t.Setenv("DESKTOP_UPDATE_PUBLIC_KEY", os.Getenv("DSH_UPDATE_TEST_PUBLIC_KEY"))
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	id := uploadedID(t, requestUpdate(t, r, "POST", "/api/desktop-updates", "root", data))
	if w := requestUpdate(t, r, "POST", "/api/desktop-updates/"+id+"/publish", "root", nil); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}
