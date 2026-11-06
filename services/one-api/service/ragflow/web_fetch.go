package ragflow

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/songquanpeng/one-api/common/resourcerelay"
)

var htmlTitlePattern = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

const maxWebPageBytes = 5 << 20

// dialPublicHost connects only to public HTTP(S) targets. Tests may replace it.
var dialPublicHost = resourcerelay.DialPublic

// fetchPublicWebDocument downloads one public http(s) page for local RAGFlow upload.
// Deployed RAGFlow builds that ignore `?type=web` still accept the HTML/PDF bytes.
func fetchPublicWebDocument(ctx context.Context, pageURL, preferredName string) ([]byte, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(pageURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return nil, "", errors.New("链接格式无效")
	}
	client := &http.Client{
		Timeout: 90 * time.Second,
		Transport: &http.Transport{
			Proxy:                 nil,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          4,
			IdleConnTimeout:       30 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
			DialContext: func(dialCtx context.Context, network, address string) (net.Conn, error) {
				host, port, splitErr := net.SplitHostPort(address)
				if splitErr != nil {
					return nil, splitErr
				}
				return dialPublicHost(dialCtx, host, port)
			},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("网页跳转次数过多")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return errors.New("不支持的网页跳转协议")
			}
			if req.URL.User != nil {
				return errors.New("不支持带凭证的网页跳转")
			}
			return nil
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", err
	}
	request.Header.Set("User-Agent", "WanweiKnowledgeBot/1.0")
	request.Header.Set("Accept", "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8")
	response, err := client.Do(request)
	if err != nil {
		return nil, "", fmt.Errorf("网页抓取失败：%s", err.Error())
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("网页抓取失败：HTTP %d", response.StatusCode)
	}
	limited := io.LimitReader(response.Body, maxWebPageBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, "", fmt.Errorf("网页抓取失败：%s", err.Error())
	}
	if len(body) > maxWebPageBytes {
		return nil, "", errors.New("网页内容过大")
	}
	if len(body) == 0 {
		return nil, "", errors.New("网页内容为空")
	}
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if strings.Contains(contentType, "application/pdf") {
		return body, webDocumentUploadName(preferredName, parsed, contentType), nil
	}
	if !utf8.Valid(body) && !looksLikeHTML(body) {
		return nil, "", errors.New("网页内容不是可导入的文本")
	}
	name := preferredName
	if title := sanitizeWebDocumentTitle(extractHTMLTitle(body)); title != "" {
		name = title
	}
	body = injectSourceURLMeta(body, parsed.String())
	return body, webDocumentUploadName(name, parsed, contentType), nil
}

func injectSourceURLMeta(body []byte, pageURL string) []byte {
	meta := []byte(`<meta name="wanwei-source-url" content="` + html.EscapeString(pageURL) + `">`)
	lower := strings.ToLower(string(body))
	if idx := strings.Index(lower, "<head"); idx >= 0 {
		gt := strings.Index(lower[idx:], ">")
		if gt >= 0 {
			at := idx + gt + 1
			out := make([]byte, 0, len(body)+len(meta))
			out = append(out, body[:at]...)
			out = append(out, meta...)
			out = append(out, body[at:]...)
			return out
		}
	}
	out := make([]byte, 0, len(meta)+len(body))
	out = append(out, meta...)
	out = append(out, body...)
	return out
}

func extractHTMLTitle(body []byte) string {
	match := htmlTitlePattern.FindSubmatch(body)
	if match == nil {
		return ""
	}
	title := html.UnescapeString(string(match[1]))
	title = strings.Join(strings.Fields(title), " ")
	return strings.TrimSpace(title)
}

func sanitizeWebDocumentTitle(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}
	replacer := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "：", "*", "_", "?", "_", "\"", "_",
		"<", "_", ">", "_", "|", "_", "\n", " ", "\r", " ",
	)
	title = strings.TrimSpace(replacer.Replace(title))
	title = strings.Join(strings.Fields(title), " ")
	runes := []rune(title)
	if len(runes) > 120 {
		title = string(runes[:120])
	}
	return title
}

func webDocumentUploadName(preferred string, parsed *url.URL, contentType string) string {
	name := strings.TrimSpace(preferred)
	if name == "" {
		name = WebDocumentName(parsed.String())
	}
	lower := strings.ToLower(name)
	wantPDF := strings.Contains(contentType, "application/pdf")
	switch {
	case wantPDF && !strings.HasSuffix(lower, ".pdf"):
		return trimExtension(name) + ".pdf"
	case !wantPDF && !hasWebTextExtension(lower):
		return trimExtension(name) + ".html"
	default:
		return name
	}
}

func hasWebTextExtension(lower string) bool {
	return strings.HasSuffix(lower, ".html") || strings.HasSuffix(lower, ".htm") ||
		strings.HasSuffix(lower, ".xhtml") || strings.HasSuffix(lower, ".txt") ||
		strings.HasSuffix(lower, ".md")
}

func trimExtension(name string) string {
	ext := path.Ext(name)
	if ext == "" {
		return name
	}
	return strings.TrimSuffix(name, ext)
}

func looksLikeHTML(body []byte) bool {
	sample := strings.ToLower(string(body))
	if len(sample) > 2048 {
		sample = sample[:2048]
	}
	return strings.Contains(sample, "<html") || strings.Contains(sample, "<!doctype html") ||
		strings.Contains(sample, "<head") || strings.Contains(sample, "<body")
}
