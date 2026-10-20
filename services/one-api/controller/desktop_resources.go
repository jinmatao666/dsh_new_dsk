package controller

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// The resource source is exclusive. Proxy mode never falls back to offline bundles.
type desktopResourceSettings struct {
	BypassHosts []string `json:"bypassHosts,omitempty"`
	Transport   string   `json:"transport,omitempty"`
	Source      string   `json:"source"`
	ProxyURL    string   `json:"proxyUrl"`
	AutoDetect  bool     `json:"autoDetect"`
	ProbeURLs   []string `json:"probeUrls"`
}

func validateDesktopResources(settings desktopResourceSettings) error {
	if len(settings.BypassHosts) > 32 {
		return fmt.Errorf("直连主机最多32个")
	}
	for _, host := range settings.BypassHosts {
		if len(host) > 253 || (net.ParseIP(host) == nil && !bypassHostName.MatchString(host)) {
			return fmt.Errorf("直连主机只填写域名或IP")
		}
	}
	if settings.Transport != "" && settings.Transport != "forward" && settings.Transport != "tunnel" {
		return fmt.Errorf("中转接入方式无效")
	}
	if settings.Source != "offline" && settings.Source != "proxy" {
		return fmt.Errorf("资源方式必须为 offline 或 proxy")
	}
	if settings.ProxyURL != "" {
		u, err := url.Parse(settings.ProxyURL)
		if err != nil || (u.Scheme != "http" && !(settings.Transport == "tunnel" && u.Scheme == "https")) || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return fmt.Errorf("中转地址须为 http://主机:端口，不包含账号、路径或参数")
		}
	}
	if settings.Source == "proxy" && settings.ProxyURL == "" && settings.Transport != "tunnel" {
		return fmt.Errorf("请填写联网中转地址")
	}
	if len(settings.ProbeURLs) > 4 {
		return fmt.Errorf("检测地址最多4个")
	}
	if settings.Source == "proxy" && settings.AutoDetect && len(settings.ProbeURLs) < 2 {
		return fmt.Errorf("自动检测需要至少两个返回 HTTP 204 的地址")
	}
	for _, raw := range settings.ProbeURLs {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || len(raw) > 1024 {
			return fmt.Errorf("检测地址须为 HTTPS 且不能包含账号")
		}
	}
	return nil
}

var bypassHostName = regexp.MustCompile(`^[A-Za-z0-9.-]{1,253}$`)

type offlineWheel struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type offlineBundle struct {
	ID        string         `json:"id"`
	CreatedAt int64          `json:"createdAt"`
	Files     []offlineWheel `json:"files"`
}

// This path must be persisted together with /data in production containers.
func desktopResourceRoot() string {
	if root := os.Getenv("DESKTOP_RESOURCE_DIR"); root != "" {
		return root
	}
	return filepath.Join("/data", "desktop-resources")
}

var wheelName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.+!-]*\.whl$`)
var resourceID = regexp.MustCompile(`^[a-f0-9]{32}$`)

const maxResourceBytes int64 = 512 << 20

// Import validates the complete archive into a fresh immutable directory before publication.
func importOfflineBundle(reader io.ReaderAt, size int64, root string) (offlineBundle, error) {
	result := offlineBundle{}
	archive, err := zip.NewReader(reader, size)
	if err != nil {
		return result, fmt.Errorf("不是有效 ZIP 文件")
	}
	if len(archive.File) == 0 || len(archive.File) > 2000 {
		return result, fmt.Errorf("资源包须包含1至2000个文件")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return result, err
	}
	stage, err := os.MkdirTemp(root, ".upload-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(stage)
	seen := map[string]bool{}
	var total int64
	for _, entry := range archive.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		name := entry.Name
		if !wheelName.MatchString(name) || filepath.Base(name) != name || entry.Mode()&os.ModeSymlink != 0 {
			return result, fmt.Errorf("只接受ZIP根目录中的wheel文件：%s", name)
		}
		if seen[strings.ToLower(name)] {
			return result, fmt.Errorf("重复文件：%s", name)
		}
		seen[strings.ToLower(name)] = true
		if entry.UncompressedSize64 > uint64(maxResourceBytes) {
			return result, fmt.Errorf("文件过大")
		}
		input, err := entry.Open()
		if err != nil {
			return result, err
		}
		output, err := os.OpenFile(filepath.Join(stage, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			input.Close()
			return result, err
		}
		hash := sha256.New()
		count, copyErr := io.Copy(io.MultiWriter(output, hash), io.LimitReader(input, maxResourceBytes-total+1))
		closeErr := output.Close()
		input.Close()
		total += count
		if copyErr != nil || closeErr != nil || total > maxResourceBytes {
			return result, fmt.Errorf("资源包损坏或解压总量超过512MB")
		}
		wheel, wheelErr := zip.OpenReader(filepath.Join(stage, name))
		if wheelErr != nil {
			return result, fmt.Errorf("不是有效wheel：%s", name)
		}
		metadataFound, wheelFound := false, false
		for _, member := range wheel.File {
			metadataFound = metadataFound || strings.HasSuffix(member.Name, ".dist-info/METADATA")
			wheelFound = wheelFound || strings.HasSuffix(member.Name, ".dist-info/WHEEL")
		}
		wheel.Close()
		if !metadataFound || !wheelFound {
			return result, fmt.Errorf("wheel缺少元数据：%s", name)
		}
		result.Files = append(result.Files, offlineWheel{Name: name, SHA256: hex.EncodeToString(hash.Sum(nil)), Size: count})
	}
	if len(result.Files) == 0 {
		return result, fmt.Errorf("ZIP 中没有wheel依赖")
	}
	sort.Slice(result.Files, func(i, j int) bool { return result.Files[i].Name < result.Files[j].Name })
	result.CreatedAt = time.Now().Unix()
	metadata, _ := json.Marshal(result.Files)
	hash := sha256.Sum256(metadata)
	result.ID = hex.EncodeToString(hash[:16])
	metadata, _ = json.Marshal(result)
	if err := os.WriteFile(filepath.Join(stage, "bundle.json"), metadata, 0600); err != nil {
		return result, err
	}
	final := filepath.Join(root, result.ID)
	if _, err := os.Stat(final); os.IsNotExist(err) {
		if err := os.Rename(stage, final); err != nil {
			return result, err
		}
	} else if err != nil {
		return result, err
	}
	return result, nil
}

func UploadDesktopResources(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxResourceBytes+(1<<20))
	defer func() {
		if c.Request.MultipartForm != nil {
			c.Request.MultipartForm.RemoveAll()
		}
	}()
	if err := c.Request.ParseMultipartForm(16 << 20); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "ZIP上传失败或超过512MB"})
		return
	}
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "请选择ZIP资源包"})
		return
	}
	defer file.Close()
	size, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "无法读取资源包"})
		return
	}
	bundle, err := importOfflineBundle(file, size, desktopResourceRoot())
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": err.Error()})
		return
	}
	// Atomic pointer replacement keeps readers on an entirely old or entirely new bundle.
	pointer, err := os.CreateTemp(desktopResourceRoot(), ".current-")
	if err == nil {
		name := pointer.Name()
		defer os.Remove(name)
		_, err = pointer.WriteString(bundle.ID)
		closeErr := pointer.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			err = os.Rename(name, filepath.Join(desktopResourceRoot(), "current"))
		}
	}
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "发布资源包失败"})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": bundle})
}

func currentOfflineBundle() (offlineBundle, error) {
	var bundle offlineBundle
	id, err := os.ReadFile(filepath.Join(desktopResourceRoot(), "current"))
	if err != nil || !resourceID.Match(id) {
		return bundle, fmt.Errorf("未上传离线依赖包")
	}
	body, err := os.ReadFile(filepath.Join(desktopResourceRoot(), string(id), "bundle.json"))
	if err != nil {
		return bundle, err
	}
	err = json.Unmarshal(body, &bundle)
	return bundle, err
}

func GetDesktopResources(c *gin.Context) {
	bundle, err := currentOfflineBundle()
	if err != nil {
		c.JSON(404, gin.H{"success": false, "message": "未上传离线依赖包"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": bundle})
}

// Publicly readable artifacts contain only administrator-uploaded dependency wheels, never user documents.
func ListDesktopWheels(c *gin.Context) {
	bundle, err := currentOfflineBundle()
	if err != nil {
		c.String(404, "未上传离线依赖包")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", "text/html; charset=utf-8")
	var body strings.Builder
	body.WriteString("<!doctype html><html><body>")
	for _, file := range bundle.Files {
		fmt.Fprintf(&body, `<a href="files/%s/%s#sha256=%s">%s</a><br>`, bundle.ID, url.PathEscape(file.Name), file.SHA256, html.EscapeString(file.Name))
	}
	body.WriteString("</body></html>")
	c.String(200, body.String())
}

func DownloadDesktopWheel(c *gin.Context) {
	id, name := c.Param("bundle"), c.Param("name")
	if !resourceID.MatchString(id) || !wheelName.MatchString(name) {
		c.Status(404)
		return
	}
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.File(filepath.Join(desktopResourceRoot(), id, name))
}
