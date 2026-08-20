package controller

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// 发布记录探测（路线 B）：定时轮询三端线上版本源，变化即记录。
// 探测只能记"发现时间"（非精确部署时刻）+ 版本/信号，记不到具体操作人。
//
// 各端探测信号：
//   app     —— parvis-updates/latest.json 的 version（pub_date 辅助）
//   web     —— 主站首页 <meta name="site-version"> 的值
//   backend —— /api/status 的 start_time（go run 模式 version 恒为 v0.0.0 不可用，
//              改用进程启动时间；"重启"近似"发布"，记录语义为后端重启）

var versionDetectHTTPClient = &http.Client{Timeout: 15 * time.Second}

// 探测目标地址，可用环境变量覆盖（测试/私有部署）
func detectAppLatestURL() string {
	return strings.TrimSpace(os.Getenv("RELEASE_DETECT_APP_URL"))
}

func detectWebHomeURL() string {
	return strings.TrimSpace(os.Getenv("RELEASE_DETECT_WEB_URL"))
}

func detectBackendStatusURL() string {
	return strings.TrimSpace(os.Getenv("RELEASE_DETECT_BACKEND_URL"))
}

// DetectVersionReleases 探测三端版本变化并记录（供定时任务调用）。
func DetectVersionReleases() {
	detectAppRelease()
	detectWebRelease()
	detectBackendRelease()
}

// recordIfChanged 若 signal 与该平台最近一条记录不同，则插入新记录。
func recordIfChanged(platform, version, signal string) {
	if signal == "" {
		return
	}
	last, err := model.GetLatestVersionRelease(platform)
	if err == nil && last != nil && last.Signal == signal {
		return // 未变化
	}
	rec := &model.VersionRelease{Platform: platform, Version: version, Signal: signal}
	if err := model.CreateVersionRelease(rec); err != nil {
		logger.SysError("记录发布失败(" + platform + "): " + err.Error())
		return
	}
	logger.SysLog("探测到发布变化: " + platform + " version=" + version + " signal=" + signal)
}

func detectAppRelease() {
	url := detectAppLatestURL()
	if url == "" {
		return
	}
	resp, err := versionDetectHTTPClient.Get(url)
	if err != nil {
		logger.SysError("探测 app 版本失败: " + err.Error())
		return
	}
	defer resp.Body.Close()
	var data struct {
		Version string `json:"version"`
		PubDate string `json:"pub_date"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		logger.SysError("解析 app latest.json 失败: " + err.Error())
		return
	}
	// signal 用 version+pub_date，二者任一变化都记录
	recordIfChanged(model.VersionPlatformApp, data.Version, data.Version+"@"+data.PubDate)
}

func detectWebRelease() {
	url := detectWebHomeURL()
	if url == "" {
		return
	}
	resp, err := versionDetectHTTPClient.Get(url)
	if err != nil {
		logger.SysError("探测主站版本失败: " + err.Error())
		return
	}
	defer resp.Body.Close()
	body, err := readBodyLimited(resp, 1<<20) // 最多读 1MB
	if err != nil {
		logger.SysError("读取主站首页失败: " + err.Error())
		return
	}
	version := extractSiteVersion(body)
	if version == "" {
		return // 主站尚未埋版本号，跳过（不算错误）
	}
	recordIfChanged(model.VersionPlatformWeb, version, version)
}

func detectBackendRelease() {
	url := detectBackendStatusURL()
	if url == "" {
		return
	}
	resp, err := versionDetectHTTPClient.Get(url)
	if err != nil {
		logger.SysError("探测后端版本失败: " + err.Error())
		return
	}
	defer resp.Body.Close()
	var data struct {
		Data struct {
			Version   string `json:"version"`
			StartTime int64  `json:"start_time"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		logger.SysError("解析后端 status 失败: " + err.Error())
		return
	}
	if data.Data.StartTime == 0 {
		return
	}
	// version 恒为 v0.0.0 不可用，signal 用 start_time（重启即变）
	signal := "start_time=" + strconv.FormatInt(data.Data.StartTime, 10)
	recordIfChanged(model.VersionPlatformBackend, data.Data.Version, signal)
}

// AdminListVersionReleases 后台：列出发布记录（可按 platform 过滤）。
func AdminListVersionReleases(c *gin.Context) {
	platform := c.Query("platform")
	limit, _ := strconv.Atoi(c.Query("limit"))
	records, err := model.ListVersionReleases(platform, limit)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": records})
}

// readBodyLimited 读取响应体，最多 max 字节，避免主站页面过大占内存。
func readBodyLimited(resp *http.Response, max int64) (string, error) {
	b, err := io.ReadAll(io.LimitReader(resp.Body, max))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// siteVersionRe 匹配 <meta name="site-version" content="xxx">（属性顺序/引号宽松）
var siteVersionRe = regexp.MustCompile(`(?i)<meta[^>]*name=["']site-version["'][^>]*content=["']([^"']+)["']`)

// extractSiteVersion 从首页 HTML 提取 site-version；无则返回空串。
func extractSiteVersion(html string) string {
	m := siteVersionRe.FindStringSubmatch(html)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}
