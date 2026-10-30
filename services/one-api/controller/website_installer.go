package controller

import (
	"crypto/rand"
	"crypto/sha256"
	"debug/pe"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/Masterminds/semver/v3"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/deployment"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var websiteInstallerUploadGate = make(chan struct{}, 1)
var websiteInstallerPublication sync.Mutex

// Reuse the updater's persistent mount without sharing its artifact directories.
func websiteInstallerRoot() string { return filepath.Join(desktopUpdateRoot(), "website-installers") }
func websiteInstallerExtension(platform string) string {
	switch platform {
	case "windows-x64":
		return ".exe"
	case "macos-x64", "macos-arm64":
		return ".dmg"
	default:
		return ""
	}
}

// DMG architecture and product version remain administrator-supplied build metadata.
func validateWebsiteInstallerFile(path, platform string) error {
	if platform == "windows-x64" {
		binary, err := pe.Open(path)
		if err != nil {
			return errors.New("请上传有效的 Windows EXE 安装程序，不要上传 ZIP")
		}
		defer binary.Close()
		if binary.Machine != pe.IMAGE_FILE_MACHINE_AMD64 || binary.Characteristics&pe.IMAGE_FILE_EXECUTABLE_IMAGE == 0 || binary.Characteristics&pe.IMAGE_FILE_DLL != 0 {
			return errors.New("仅支持 Windows x64 EXE 安装程序")
		}
		return nil
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() < 512 {
		return errors.New("请上传有效的 DMG 安装包")
	}
	trailer := make([]byte, 4)
	if _, err := file.ReadAt(trailer, info.Size()-512); err != nil || string(trailer) != "koly" {
		return errors.New("请上传有效的 DMG 安装包，不要上传更新压缩包")
	}
	return nil
}

// AdminUploadWebsiteInstaller bounds, validates and hashes a file before recording an unpublished upload.
func AdminUploadWebsiteInstaller(c *gin.Context) {
	limit, err := desktopUpdateLimit()
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	select {
	case websiteInstallerUploadGate <- struct{}{}:
		defer func() { <-websiteInstallerUploadGate }()
	default:
		c.JSON(429, gin.H{"success": false, "message": "已有安装包正在上传，请稍后重试"})
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
	version := strings.TrimSpace(c.PostForm("version"))
	parsed, err := semver.StrictNewVersion(version)
	if err != nil || parsed.Prerelease() != "" || parsed.Metadata() != "" {
		desktopUpdateFailure(c, errors.New("请填写正式版本号，例如 1.0.2"))
		return
	}
	platform := c.PostForm("platform")
	extension := websiteInstallerExtension(platform)
	if extension == "" {
		desktopUpdateFailure(c, errors.New("请选择 Windows x64、macOS x64 或 macOS ARM64"))
		return
	}
	notes := c.PostForm("notes")
	if len(notes) > 16000 {
		desktopUpdateFailure(c, errors.New("版本说明过长"))
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		desktopUpdateFailure(c, errors.New("请选择安装包"))
		return
	}
	defer file.Close()
	if !strings.HasSuffix(strings.ToLower(header.Filename), extension) {
		desktopUpdateFailure(c, errors.New("安装包格式与所选系统不一致"))
		return
	}
	root := websiteInstallerRoot()
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
	path := filepath.Join(stage, "installer")
	output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	hash := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(output, hash), io.LimitReader(file, limit+1))
	closeErr := output.Close()
	if copyErr != nil || closeErr != nil || size == 0 || size > limit {
		desktopUpdateFailure(c, errors.New("安装包为空、超过限制或保存失败"))
		return
	}
	if err := validateWebsiteInstallerFile(path, platform); err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	record := model.WebsiteInstaller{ID: hex.EncodeToString(id), Platform: platform, Version: version, Filename: fmt.Sprintf("WanweiBuddy-%s-%s%s", version, platform, extension), Size: size, SHA256: hex.EncodeToString(hash.Sum(nil)), Notes: notes, CreatedBy: c.GetInt("id")}
	final := filepath.Join(root, record.ID)
	if err := os.Rename(stage, final); err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	if err := model.DB.Create(&record).Error; err != nil {
		_ = os.RemoveAll(final)
		desktopUpdateFailure(c, errors.New("保存安装包记录失败"))
		return
	}
	c.JSON(200, gin.H{"success": true, "data": record})
}

// AdminListWebsiteInstallers returns history and the current platform selections, without private paths.
func AdminListWebsiteInstallers(c *gin.Context) {
	var items []model.WebsiteInstaller
	var channels []model.WebsiteInstallerChannel
	if err := model.DB.Order("created_at desc").Limit(200).Find(&items).Error; err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	if err := model.DB.Find(&channels).Error; err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	limit, err := desktopUpdateLimit()
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": items, "channels": channels, "max_bytes": limit}})
}

// AdminChangeWebsiteInstaller serializes publication and deletion against the selected record.
func AdminChangeWebsiteInstaller(c *gin.Context) {
	id, action := c.Param("id"), c.Param("action")
	if c.Request.Method == http.MethodDelete {
		action = "delete"
	}
	if !desktopUpdateID.MatchString(id) || (action != "publish" && action != "withdraw" && action != "delete") {
		c.Status(404)
		return
	}
	websiteInstallerPublication.Lock()
	defer websiteInstallerPublication.Unlock()
	var record model.WebsiteInstaller
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&record, "id = ?", id).Error; err != nil {
			return err
		}
		initial := model.WebsiteInstallerChannel{Platform: record.Platform}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&initial).Error; err != nil {
			return err
		}
		var channel model.WebsiteInstallerChannel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&channel, "platform = ?", record.Platform).Error; err != nil {
			return err
		}
		if action == "delete" {
			if channel.Published && channel.ReleaseID == id {
				return errors.New("请先撤下已发布的安装包，再删除")
			}
			if channel.ReleaseID == id {
				if err := tx.Model(&channel).Update("release_id", "").Error; err != nil {
					return err
				}
			}
			return tx.Delete(&record).Error
		}
		if action == "withdraw" {
			if channel.ReleaseID != id || !channel.Published {
				return errors.New("此安装包不是当前已发布版本，请刷新列表")
			}
			channel.Published = false
		} else {
			file, err := os.Open(filepath.Join(websiteInstallerRoot(), id, "installer"))
			if err != nil {
				return errors.New("安装包文件不存在或不可读，不能发布")
			}
			hash := sha256.New()
			size, copyErr := io.Copy(hash, file)
			closeErr := file.Close()
			if copyErr != nil || closeErr != nil || size != record.Size || hex.EncodeToString(hash.Sum(nil)) != record.SHA256 {
				return errors.New("安装包校验不一致，请重新上传")
			}
			channel.ReleaseID = id
			channel.Published = true
		}
		channel.UpdatedAt = time.Now().UTC()
		channel.UpdatedBy = c.GetInt("id")
		return tx.Save(&channel).Error
	})
	if err != nil {
		desktopUpdateFailure(c, err)
		return
	}
	message := "操作成功"
	if action == "delete" {
		path := filepath.Join(websiteInstallerRoot(), id, "installer")
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			message = "记录已删除，文件清理失败，请管理员检查存储目录"
			logger.SysLog("website-installer cleanup failed: " + id)
		} else {
			_ = os.Remove(filepath.Dir(path))
		}
	}
	c.JSON(200, gin.H{"success": true, "message": message})
}

// PublicWebsiteInstallers returns published targets with canonical URLs when configured.
func PublicWebsiteInstallers(c *gin.Context) {
	c.Header("Access-Control-Allow-Origin", "*")
	var items []struct {
		model.WebsiteInstaller
		PublishedAt time.Time `json:"published_at"`
	}
	err := model.DB.Table("website_installers").Select("website_installers.*, website_installer_channels.updated_at as published_at").Joins("JOIN website_installer_channels ON website_installer_channels.release_id = website_installers.id AND website_installer_channels.platform = website_installers.platform AND website_installer_channels.published = ?", true).Order("website_installers.platform").Scan(&items).Error
	if err != nil {
		c.JSON(503, gin.H{"success": false, "message": "安装包信息暂时不可用"})
		return
	}
	packages := make([]gin.H, 0, len(items))
	for _, item := range items {
		parts := strings.SplitN(item.Platform, "-", 2)
		if len(parts) != 2 || websiteInstallerExtension(item.Platform) == "" {
			continue
		}
		downloadURL := deployment.Current.APIPrefix + "/downloads/installers/" + item.ID
		if deployment.Current.PublicURL != "" {
			downloadURL = deployment.Current.External(c.Request, "downloads/installers/"+item.ID)
		}
		packages = append(packages, gin.H{"platform": parts[0], "arch": parts[1], "version": item.Version, "size": fmt.Sprintf("%.1f MB", float64(item.Size)/1048576), "size_bytes": item.Size, "sha256": item.SHA256, "notes": item.Notes, "publishedAt": item.PublishedAt, "url": downloadURL, "filename": item.Filename})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"packages": packages})
}

// DownloadWebsiteInstaller serves published files with Range/HEAD support; drafts return 404.
func DownloadWebsiteInstaller(c *gin.Context) {
	id := c.Param("id")
	if !desktopUpdateID.MatchString(id) {
		c.Status(404)
		return
	}
	var record model.WebsiteInstaller
	err := model.DB.Table("website_installers").Select("website_installers.*").Joins("JOIN website_installer_channels ON website_installer_channels.release_id = website_installers.id AND website_installer_channels.platform = website_installers.platform AND website_installer_channels.published = ?", true).Where("website_installers.id = ?", id).First(&record).Error
	if err != nil {
		c.Status(404)
		return
	}
	file, err := os.Open(filepath.Join(websiteInstallerRoot(), id, "installer"))
	if err != nil {
		c.Status(404)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() != record.Size {
		c.Status(503)
		return
	}
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", record.Filename))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "no-store")
	http.ServeContent(c.Writer, c.Request, record.Filename, info.ModTime(), file)
}
