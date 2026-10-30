package controller

import (
	"archive/zip"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/songquanpeng/one-api/common/deployment"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"aead.dev/minisign"
	"github.com/Masterminds/semver/v3"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Each upload ZIP contains exactly release.json, release.json.sig and the named artifact.
// Both artifact and manifest are signed: a signed old binary cannot be relabelled as a new version.
type desktopUpdateManifest struct {
	Schema    int    `json:"schema"`
	Product   string `json:"product"`
	Version   string `json:"version"`
	Platform  string `json:"platform"`
	File      string `json:"file"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
	Signature string `json:"signature"`
	BuildID   string `json:"build_id,omitempty"`
}

var desktopUpdateUploadGate = make(chan struct{}, 1)
var desktopUpdatePublication sync.Mutex
var desktopUpdateOlderConfirmation = errors.New("发布版本低于该平台历史发布版本，请确认是否继续发布")
var desktopUpdateID = regexp.MustCompile(`^[a-f0-9]{32}$`)
var desktopUpdateFilename = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$`)
var desktopUpdateBuildID = regexp.MustCompile(`^[0-9]{1,40}$`)

func desktopUpdateRoot() string {
	if root := os.Getenv("DESKTOP_UPDATE_DIR"); root != "" {
		return root
	}
	return "/data/wanwei/desktop-updates"
}

func desktopUpdateLimit() (int64, error) {
	const fallback = int64(2 << 30)
	if raw := os.Getenv("DESKTOP_UPDATE_MAX_BYTES"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1024 || n > 8<<30 {
			return 0, errors.New("DESKTOP_UPDATE_MAX_BYTES 必须在 1024–8589934592 之间")
		}
		return n, nil
	}
	return fallback, nil
}

func desktopUpdateKey() (minisign.PublicKey, error) {
	var key minisign.PublicKey
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("DESKTOP_UPDATE_PUBLIC_KEY")))
	if err != nil || len(raw) == 0 {
		return key, errors.New("尚未配置桌面更新公钥，禁止上传和发布")
	}
	if err := key.UnmarshalText(raw); err != nil {
		return key, errors.New("桌面更新公钥格式无效")
	}
	return key, nil
}

func verifyDesktopUpdate(reader io.Reader, signature string, key minisign.PublicKey) error {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signature))
	if err != nil {
		return errors.New("更新签名格式无效")
	}
	var sig minisign.Signature
	if err := sig.UnmarshalText(raw); err != nil || sig.Algorithm != minisign.HashEdDSA {
		return errors.New("更新包须使用 Minisign 预哈希签名")
	}
	verifier := minisign.NewReader(reader)
	if _, err := io.Copy(io.Discard, verifier); err != nil {
		return err
	}
	if !verifier.Verify(key, raw) {
		return errors.New("更新签名验证失败")
	}
	return nil
}

func readDesktopUpdateEntry(entry *zip.File, limit int64) ([]byte, error) {
	if entry.UncompressedSize64 > uint64(limit) {
		return nil, errors.New("更新清单过大")
	}
	r, err := entry.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, errors.New("更新清单读取失败或超限")
	}
	return data, nil
}

func validDesktopPlatform(platform, file string) bool {
	switch platform {
	case "windows-x86_64":
		return strings.HasSuffix(file, ".exe")
	case "darwin-x86_64", "darwin-aarch64":
		return strings.HasSuffix(file, ".app.tar.gz")
	case "linux-x86_64", "linux-aarch64":
		return strings.HasSuffix(file, ".AppImage")
	default:
		return false
	}
}

func unpackDesktopUpdate(path, destination string, limit int64, key minisign.PublicKey) (desktopUpdateManifest, string, string, error) {
	var manifest desktopUpdateManifest
	archive, err := zip.OpenReader(path)
	if err != nil {
		return manifest, "", "", err
	}
	defer archive.Close()
	if len(archive.File) != 3 {
		return manifest, "", "", errors.New("发布 ZIP 必须仅包含清单、清单签名和一个更新包")
	}
	entries := map[string]*zip.File{}
	for _, entry := range archive.File {
		if !entry.Mode().IsRegular() || entry.Name != filepath.Base(entry.Name) || strings.ContainsAny(entry.Name, `/\`) || entries[entry.Name] != nil {
			return manifest, "", "", errors.New("发布 ZIP 含重复名称、不安全路径或非普通文件")
		}
		entries[entry.Name] = entry
	}
	if entries["release.json"] == nil || entries["release.json.sig"] == nil {
		return manifest, "", "", errors.New("缺少发布清单或清单签名")
	}
	data, err := readDesktopUpdateEntry(entries["release.json"], 16384)
	if err != nil {
		return manifest, "", "", err
	}
	signature, err := readDesktopUpdateEntry(entries["release.json.sig"], 4096)
	if err != nil {
		return manifest, "", "", err
	}
	if err := verifyDesktopUpdate(strings.NewReader(string(data)), string(signature), key); err != nil {
		return manifest, "", "", err
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, "", "", err
	}
	v, err := semver.StrictNewVersion(manifest.Version)
	if err != nil || v.Prerelease() != "" || v.Metadata() != "" || manifest.Schema != 1 || manifest.Product != "com.wanwei.harness" ||
		!desktopUpdateFilename.MatchString(manifest.File) || !validDesktopPlatform(manifest.Platform, manifest.File) ||
		manifest.Size <= 0 || manifest.Size > limit || len(manifest.Signature) > 4096 ||
		(manifest.BuildID != "" && !desktopUpdateBuildID.MatchString(manifest.BuildID)) {
		return manifest, "", "", errors.New("发布清单字段无效（正式通道只接受 x.y.z 版本）")
	}
	artifact := entries[manifest.File]
	if artifact == nil || artifact.UncompressedSize64 != uint64(manifest.Size) {
		return manifest, "", "", errors.New("更新包缺失或大小不匹配")
	}
	r, err := artifact.Open()
	if err != nil {
		return manifest, "", "", err
	}
	defer r.Close()
	out, err := os.OpenFile(filepath.Join(destination, "artifact"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return manifest, "", "", err
	}
	hash := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(out, hash), io.LimitReader(r, manifest.Size+1))
	syncErr := out.Sync()
	closeErr := out.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || n != manifest.Size || hex.EncodeToString(hash.Sum(nil)) != manifest.SHA256 {
		return manifest, "", "", errors.New("更新包内容校验失败")
	}
	if err := verifyDesktopUpdateFile(filepath.Join(destination, "artifact"), manifest.Signature, key); err != nil {
		return manifest, "", "", err
	}
	return manifest, string(data), strings.TrimSpace(string(signature)), nil
}

func verifyDesktopUpdateFile(path, signature string, key minisign.PublicKey) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return verifyDesktopUpdate(file, signature, key)
}

func desktopUpdateFailure(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
}

// AdminUploadDesktopUpdate stages one signed platform bundle without making it public.
func AdminUploadDesktopUpdate(c *gin.Context) {
	key, err := desktopUpdateKey()
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	limit, err := desktopUpdateLimit()
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	select {
	case desktopUpdateUploadGate <- struct{}{}:
		defer func() { <-desktopUpdateUploadGate }()
	default:
		c.JSON(429, gin.H{"success": false, "message": "已有更新包正在校验，请稍后重试"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit+(1<<20))
	defer func() {
		if c.Request.MultipartForm != nil {
			_ = c.Request.MultipartForm.RemoveAll()
		}
	}()
	if err := c.Request.ParseMultipartForm(1 << 20); err != nil {
		desktopUpdateFailure(c, errors.New("上传失败或文件超过大小限制"))
		return
	}
	notes := c.PostForm("notes")
	expectedVersion := strings.TrimSpace(c.PostForm("version"))
	expectedPlatform := strings.TrimSpace(c.PostForm("platform"))
	requestedVersion, versionErr := semver.StrictNewVersion(expectedVersion)
	if versionErr != nil || requestedVersion.Prerelease() != "" || requestedVersion.Metadata() != "" {
		desktopUpdateFailure(c, errors.New("请填写正式版本号，例如 0.0.5"))
		return
	}
	if expectedPlatform == "" || len(expectedPlatform) > 64 {
		desktopUpdateFailure(c, errors.New("请选择操作系统和架构"))
		return
	}
	if len(notes) > 16000 {
		desktopUpdateFailure(c, errors.New("更新说明过长"))
		return
	}
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	defer file.Close()
	root := desktopUpdateRoot()
	if err := os.MkdirAll(root, 0700); err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	stage, err := os.MkdirTemp(root, ".upload-")
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	defer os.RemoveAll(stage)
	archivePath := filepath.Join(stage, "upload.zip")
	archive, err := os.OpenFile(archivePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	_, err = io.Copy(archive, file)
	closeErr := archive.Close()
	if err != nil || closeErr != nil {
		desktopUpdateFailure(c, errors.New("保存上传失败"))
		return
	}
	manifest, data, signature, err := unpackDesktopUpdate(archivePath, stage, limit, key)
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	if expectedVersion != manifest.Version || expectedPlatform != manifest.Platform {
		desktopUpdateFailure(c, fmt.Errorf("填写的版本或平台与签名包不一致；包内版本为 %s，平台为 %s，请核对后重新上传", manifest.Version, manifest.Platform))
		return
	}
	if err := os.Remove(archivePath); err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	record := model.DesktopUpdate{ID: hex.EncodeToString(id), Platform: manifest.Platform, Version: manifest.Version, Notes: notes, Manifest: data, ManifestSignature: signature, Size: manifest.Size, CreatedBy: c.GetInt("id")}
	final := filepath.Join(root, record.ID)
	if err := os.Rename(stage, final); err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	if err := model.DB.Create(&record).Error; err != nil {
		_ = os.RemoveAll(final)
		desktopUpdateFailure(c, errors.New("保存更新包失败"))
		return
	}
	c.JSON(200, gin.H{"success": true, "data": record})
}

// AdminListDesktopUpdates returns bounded uploads and the active platform pointers.
func AdminListDesktopUpdates(c *gin.Context) {
	var records []model.DesktopUpdate
	var channels []model.DesktopUpdateChannel
	if err := model.DB.Order("created_at desc").Limit(200).Find(&records).Error; err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	if err := model.DB.Find(&channels).Error; err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	_, keyErr := desktopUpdateKey()
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": records, "channels": channels, "signing_configured": keyErr == nil}})
}

// AdminPublishDesktopUpdate revalidates signatures and atomically selects one platform release.
func AdminPublishDesktopUpdate(c *gin.Context) { changeDesktopUpdate(c, true) }

// AdminWithdrawDesktopUpdate hides the active platform without falling back to an older upload.
func AdminWithdrawDesktopUpdate(c *gin.Context) { changeDesktopUpdate(c, false) }

// AdminDeleteDesktopUpdate removes an unpublished upload, retaining the channel's version high-water mark.
func AdminDeleteDesktopUpdate(c *gin.Context) {
	id := c.Param("id")
	if !desktopUpdateID.MatchString(id) {
		desktopUpdateFailure(c, errors.New("版本标识无效"))
		return
	}
	desktopUpdatePublication.Lock()
	defer desktopUpdatePublication.Unlock()
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var record model.DesktopUpdate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&record, "id = ?", id).Error; err != nil {
			return err
		}
		var channel model.DesktopUpdateChannel
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&channel, "platform = ?", record.Platform).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && channel.ReleaseID == id {
			if channel.Published {
				return errors.New("该更新包正在发布中，请先撤下再删除")
			}
			if err := tx.Model(&channel).Update("release_id", "").Error; err != nil {
				return err
			}
		}
		return tx.Delete(&record).Error
	})
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	// Commit visibility first; a cleanup failure must not restore a downloadable record.
	message := "更新包及发布记录已删除"
	if err := os.RemoveAll(filepath.Join(desktopUpdateRoot(), id)); err != nil {
		logger.SysErrorf("desktop update artifact cleanup failed for %s: %v", id, err)
		message = "发布记录已删除，但更新包文件清理失败，请联系运维清理"
	}
	c.JSON(200, gin.H{"success": true, "message": message})
}

func changeDesktopUpdate(c *gin.Context, publish bool) {
	if !desktopUpdateID.MatchString(c.Param("id")) {
		desktopUpdateFailure(c, errors.New("版本标识无效"))
		return
	}
	desktopUpdatePublication.Lock()
	defer desktopUpdatePublication.Unlock()
	previousVersion := ""
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var record model.DesktopUpdate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&record, "id = ?", c.Param("id")).Error; err != nil {
			return err
		}
		if publish {
			key, err := desktopUpdateKey()
			if err != nil {
				return err
			}
			if err := verifyDesktopUpdate(strings.NewReader(record.Manifest), record.ManifestSignature, key); err != nil {
				return err
			}
			var manifest desktopUpdateManifest
			if err := json.Unmarshal([]byte(record.Manifest), &manifest); err != nil {
				return err
			}
			if err := verifyDesktopUpdateFile(filepath.Join(desktopUpdateRoot(), record.ID, "artifact"), manifest.Signature, key); err != nil {
				return err
			}
		}
		channel := model.DesktopUpdateChannel{Platform: record.Platform}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&channel).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&channel, "platform = ?", record.Platform).Error; err != nil {
			return err
		}
		highWaterVersion := record.Version
		if channel.Version != "" {
			var retained int64
			if err := tx.Model(&model.DesktopUpdate{}).Where("platform = ? AND version = ?", record.Platform, channel.Version).Count(&retained).Error; err != nil {
				return err
			}
			previous, err := semver.StrictNewVersion(channel.Version)
			if err != nil {
				return err
			}
			candidate, err := semver.StrictNewVersion(record.Version)
			if err != nil {
				return err
			}
			// Deleted uploads must not keep triggering publication warnings, including
			// channels left behind by earlier deployments.
			if retained > 0 && candidate.LessThan(previous) {
				highWaterVersion = channel.Version
				if publish && c.Query("confirm_older") != record.Version {
					previousVersion = channel.Version
					return desktopUpdateOlderConfirmation
				}
			}
		}
		if !publish && channel.ReleaseID != record.ID {
			return errors.New("只能撤下该平台当前发布的版本")
		}
		return tx.Model(&channel).Updates(map[string]interface{}{"version": highWaterVersion, "release_id": record.ID, "published": publish, "updated_by": c.GetInt("id"), "updated_at": time.Now()}).Error
	})
	if err != nil {
		if errors.Is(err, desktopUpdateOlderConfirmation) {
			c.JSON(http.StatusConflict, gin.H{"success": false, "confirmation_required": true, "previous_version": previousVersion, "message": err.Error()})
			return
		}
		desktopUpdateFailure(c, err)
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// CheckDesktopUpdate is the unauthenticated Tauri endpoint, scoped to the exact OS/architecture.
func CheckDesktopUpdate(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	platform := c.Param("target") + "-" + c.Param("arch")
	current, err := semver.NewVersion(c.Param("current"))
	if err != nil || !validDesktopPlatform(platform, map[string]string{"windows": "update.exe", "darwin": "update.app.tar.gz", "linux": "update.AppImage"}[c.Param("target")]) {
		c.Status(400)
		return
	}
	var channel model.DesktopUpdateChannel
	err = model.DB.First(&channel, "platform = ?", platform).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(204)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	if !channel.Published {
		c.Status(204)
		return
	}
	var record model.DesktopUpdate
	if err := model.DB.First(&record, "id = ?", channel.ReleaseID).Error; err != nil {
		c.Status(503)
		return
	}
	latest, err := semver.StrictNewVersion(record.Version)
	if err != nil {
		c.Status(503)
		return
	}
	if latest.LessThan(current) {
		c.Status(204)
		return
	}
	var manifest desktopUpdateManifest
	if err := json.Unmarshal([]byte(record.Manifest), &manifest); err != nil {
		c.Status(503)
		return
	}
	// Tauri requires an absolute URL. Native clients use download_path with their
	// configured backend instead, so proxy headers cannot choose the download host.
	downloadPath := "desktop-updates/files/" + record.ID
	c.JSON(200, gin.H{"version": record.Version, "notes": record.Notes, "release_id": record.ID, "pub_date": channel.UpdatedAt.UTC().Format(time.RFC3339), "url": deployment.Current.External(c.Request, downloadPath), "download_path": downloadPath, "signature": manifest.Signature, "manifest": record.Manifest, "manifest_signature": record.ManifestSignature})
}

// DownloadDesktopUpdate exposes only the active published artifact, never an arbitrary storage path.
func DownloadDesktopUpdate(c *gin.Context) {
	id := c.Param("id")
	if !desktopUpdateID.MatchString(id) {
		c.Status(404)
		return
	}
	var record model.DesktopUpdate
	var channel model.DesktopUpdateChannel
	if model.DB.First(&record, "id = ?", id).Error != nil || model.DB.First(&channel, "platform = ? AND release_id = ? AND published = ?", record.Platform, id, true).Error != nil {
		c.Status(404)
		return
	}
	var manifest desktopUpdateManifest
	if json.Unmarshal([]byte(record.Manifest), &manifest) != nil {
		c.Status(503)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "no-store")
	c.FileAttachment(filepath.Join(desktopUpdateRoot(), id, "artifact"), manifest.File)
}
