package ragflow

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestWebDocumentName(t *testing.T) {
	if got := WebDocumentName("https://www.cnblogs.com/wangboyu/p/14463680.html"); got != "cnblogs.com_14463680.html" {
		t.Fatalf("got %q", got)
	}
	if got := WebDocumentName("https://example.com/"); !strings.HasPrefix(got, "example.com_") {
		t.Fatalf("got %q", got)
	}
}

func TestWebDocumentUploadName(t *testing.T) {
	parsed, err := url.Parse("https://www.cnblogs.com/a/b.html")
	if err != nil {
		t.Fatal(err)
	}
	if got := webDocumentUploadName("cnblogs.com_b.html", parsed, "text/html"); got != "cnblogs.com_b.html" {
		t.Fatalf("got %q", got)
	}
	if got := webDocumentUploadName("article", parsed, "text/html; charset=utf-8"); got != "article.html" {
		t.Fatalf("got %q", got)
	}
	if got := webDocumentUploadName("report", parsed, "application/pdf"); got != "report.pdf" {
		t.Fatalf("got %q", got)
	}
}

func TestExtractHTMLTitle(t *testing.T) {
	body := []byte(`<!doctype html><html><head><title>MySQL修改connect_timeout (连接超时) 全局变量 - 我找的就是你 - 博客园</title></head><body>hi</body></html>`)
	got := sanitizeWebDocumentTitle(extractHTMLTitle(body))
	if got != "MySQL修改connect_timeout (连接超时) 全局变量 - 我找的就是你 - 博客园" {
		t.Fatalf("got %q", got)
	}
}

func TestUploadWebDocumentFetchesPageAndUploadsFile(t *testing.T) {
	var gotPath, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/article":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("<html><body><h1>hello</h1></body></html>"))
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/v1/datasets/"):
			gotPath = r.URL.String()
			body, _ := io.ReadAll(r.Body)
			gotBody = string(body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":0,"data":[{"id":"doc-web","name":"example-page.html","run":"UNSTART","size":1}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	previous := dialPublicHost
	dialPublicHost = func(ctx context.Context, host, port string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	}
	defer func() { dialPublicHost = previous }()

	client := &Client{baseURL: server.URL, apiKey: "key", http: server.Client()}
	documents, err := client.UploadWebDocument(context.Background(), "ds-1", "example-page", server.URL+"/article")
	if err != nil {
		t.Fatal(err)
	}
	if len(documents) != 1 || documents[0].Id != "doc-web" {
		t.Fatalf("documents=%v", documents)
	}
	if gotPath != "/api/v1/datasets/ds-1/documents" {
		t.Fatalf("path=%q", gotPath)
	}
	if !strings.Contains(gotBody, `name="file"`) || !strings.Contains(gotBody, "example-page.html") {
		t.Fatalf("body=%q", gotBody)
	}
	if !strings.Contains(gotBody, `name="wanwei-source-url"`) || !strings.Contains(gotBody, server.URL+"/article") {
		t.Fatalf("uploaded body missing source meta: %q", gotBody)
	}
	if !strings.Contains(gotBody, "<h1>hello</h1>") {
		t.Fatalf("uploaded body missing html: %q", gotBody)
	}
}

func TestInjectSourceURLMeta(t *testing.T) {
	withHead := injectSourceURLMeta([]byte("<html><head><title>t</title></head><body>x</body></html>"), "https://example.com/a")
	if !strings.Contains(string(withHead), `<meta name="wanwei-source-url" content="https://example.com/a">`) {
		t.Fatalf("got %q", withHead)
	}
	noHead := injectSourceURLMeta([]byte("<html><body>x</body></html>"), "https://example.com/b")
	if !strings.HasPrefix(string(noHead), `<meta name="wanwei-source-url" content="https://example.com/b">`) {
		t.Fatalf("got %q", noHead)
	}
}
