// Package deployment owns public paths independently of build-time assets.
package deployment

import (
	"encoding/json"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
)

// Settings contains public deployment information only. Secrets never reach the browser.
type Settings struct {
	OrgPrefix   string `json:"orgPrefix"`
	AdminPrefix string `json:"adminPrefix"`
	APIPrefix   string `json:"apiPrefix"`
	PublicURL   string `json:"publicURL"`
	AdminURL    string `json:"adminURL"`
}

var Current Settings

// Parse validates externally visible prefixes and the complete canonical API URL.
func Parse(get func(string) string) (Settings, error) {
	s := Settings{AdminPrefix: get("DSH_ADMIN_PREFIX"), APIPrefix: get("DSH_API_PREFIX"), PublicURL: strings.TrimRight(get("DSH_PUBLIC_URL"), "/")}
	s.AdminURL = strings.TrimRight(get("DSH_ADMIN_URL"), "/")
	s.OrgPrefix = get("DSH_ORG_PREFIX")
	if s.OrgPrefix == "" {
		s.OrgPrefix = "/business"
	}
	for name, value := range map[string]*string{"DSH_ADMIN_PREFIX": &s.AdminPrefix, "DSH_API_PREFIX": &s.APIPrefix, "DSH_ORG_PREFIX": &s.OrgPrefix} {
		if *value == "/" {
			*value = ""
		}
		if *value != "" && (!strings.HasPrefix(*value, "/") || !regexp.MustCompile(`^/[A-Za-z0-9._~/-]+$`).MatchString(*value) || strings.HasPrefix(*value, "//") || path.Clean(*value) != *value || strings.HasSuffix(*value, "/")) {
			return s, fmt.Errorf("%s must be empty, /, or a normalized path such as /dsh-admin (no trailing slash)", name)
		}
	}
	if s.AdminPrefix != "" && s.APIPrefix != "" && (under(s.AdminPrefix, s.APIPrefix) || under(s.APIPrefix, s.AdminPrefix)) {
		return s, fmt.Errorf("admin and API prefixes must not overlap")
	}
	for name, entry := range map[string]struct{ value, prefix string }{
		"DSH_PUBLIC_URL": {s.PublicURL, s.APIPrefix}, "DSH_ADMIN_URL": {s.AdminURL, s.AdminPrefix},
	} {
		if entry.value == "" {
			continue
		}
		u, e := url.Parse(entry.value)
		if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return s, fmt.Errorf("%s must be a complete HTTP(S) base URL, including its path prefix", name)
		}
		if u.Path != entry.prefix {
			return s, fmt.Errorf("%s path must equal its configured path prefix", name)
		}
	}
	for _, origin := range strings.Split(get("CORS_ALLOW_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		u, e := url.Parse(strings.TrimSpace(origin))
		if e != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "tauri") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return s, fmt.Errorf("CORS_ALLOW_ORIGINS requires comma-separated origins without paths")
		}
	}
	for _, proxy := range strings.Split(get("DSH_TRUSTED_PROXIES"), ",") {
		proxy = strings.TrimSpace(proxy)
		if proxy == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(proxy); err != nil && net.ParseIP(proxy) == nil {
			return s, fmt.Errorf("DSH_TRUSTED_PROXIES requires IP addresses or CIDRs")
		}
	}
	return s, nil
}

// TrustedProxies defaults to loopback. External proxies must be explicitly listed.
func TrustedProxies() []string {
	value, configured := os.LookupEnv("DSH_TRUSTED_PROXIES")
	if !configured {
		return []string{"127.0.0.1", "::1"}
	}
	var result []string
	for _, entry := range strings.Split(value, ",") {
		if entry = strings.TrimSpace(entry); entry != "" {
			result = append(result, entry)
		}
	}
	return result
}
func Configure() error {
	s, e := Parse(os.Getenv)
	if e == nil {
		Current = s
	}
	return e
}
func under(p, base string) bool { return p == base || strings.HasPrefix(p, base+"/") }
func isAPI(p string) bool {
	for _, base := range []string{"/api", "/v1", "/v1beta", "/dashboard/billing", "/desktop-updates", "/downloads"} {
		if under(p, base) {
			return true
		}
	}
	return false
}

// Handler accepts preserved external prefixes without trusting forwarded host or prefix headers.
func (s Settings) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		prefix := ""
		if s.APIPrefix != "" && under(r.URL.Path, s.APIPrefix) {
			prefix = s.APIPrefix
		} else if s.AdminPrefix != "" && under(r.URL.Path, s.AdminPrefix) {
			prefix = s.AdminPrefix
		} else if s.APIPrefix != "" && isAPI(r.URL.Path) {
			http.NotFound(w, r)
			return
		} else if s.AdminPrefix != "" && !isAPI(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		if prefix != "" {
			if r.URL.Path == prefix && prefix == s.AdminPrefix {
				u := *r.URL
				u.Path += "/"
				http.Redirect(w, r, u.RequestURI(), http.StatusTemporaryRedirect)
				return
			}
			clone := r.Clone(r.Context())
			u := *r.URL
			clone.URL = &u
			clone.URL.Path = strings.TrimPrefix(u.Path, prefix)
			if clone.URL.Path == "" {
				clone.URL.Path = "/"
			}
			clone.URL.RawPath = ""
			clone.RequestURI = clone.URL.RequestURI()
			r = clone
			if (prefix == s.APIPrefix && !isAPI(r.URL.Path)) || (prefix == s.AdminPrefix && s.APIPrefix != "" && isAPI(r.URL.Path)) {
				http.NotFound(w, r)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// HTML injects a public bootstrap before any styles or scripts. Embedded JS stays immutable.
func (s Settings) HTML(index []byte) []byte {
	config, _ := json.Marshal(s)
	bootstrap := fmt.Sprintf(`<base href="%s/"><script>window.__DSH_DEPLOYMENT__=%s;</script>`, html.EscapeString(s.AdminPrefix), config)
	return []byte(strings.Replace(string(index), "<head>", "<head>"+bootstrap, 1))
}

// External preserves the entire configured base path; unrelated absolute URLs are untouched.
func (s Settings) External(r *http.Request, resource string) string {
	if u, e := url.Parse(resource); e == nil && (u.IsAbs() || u.Host != "") {
		return resource
	}
	base := s.PublicURL
	if base == "" {
		scheme := "http"
		if r.TLS != nil || (trustedProxy(r.RemoteAddr) && r.Header.Get("X-Forwarded-Proto") == "https") {
			scheme = "https"
		}
		base = scheme + "://" + r.Host + s.APIPrefix
	}
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(resource, "/")
}

func trustedProxy(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, entry := range TrustedProxies() {
		if candidate := net.ParseIP(entry); candidate != nil && candidate.Equal(ip) {
			return true
		}
		if _, network, err := net.ParseCIDR(entry); err == nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

// APIBase honors explicit runtime configuration before the legacy database option.
func (s Settings) APIBase(legacy string) string {
	if s.PublicURL != "" {
		return s.PublicURL
	}
	return strings.TrimRight(legacy, "/") + s.APIPrefix
}

// AdminBase uses the public API origin with the independently configured admin path.
func (s Settings) AdminBase(legacy string) string {
	if s.AdminURL != "" {
		return s.AdminURL
	}
	if s.PublicURL == "" {
		return strings.TrimRight(legacy, "/") + s.AdminPrefix
	}
	u, _ := url.Parse(s.PublicURL)
	return u.Scheme + "://" + u.Host + s.AdminPrefix
}

// OrgHTML and OrgHandler retain the separate organization portal's existing port.
func (s Settings) OrgHTML(index []byte) []byte { s.AdminPrefix = s.OrgPrefix; return s.HTML(index) }
func (s Settings) OrgHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.OrgPrefix != "" && under(r.URL.Path, s.OrgPrefix) {
			if r.URL.Path == s.OrgPrefix {
				u := *r.URL
				u.Path += "/"
				http.Redirect(w, r, u.RequestURI(), http.StatusTemporaryRedirect)
				return
			}
			r = r.Clone(r.Context())
			u := *r.URL
			r.URL = &u
			r.URL.Path = strings.TrimPrefix(u.Path, s.OrgPrefix)
			r.URL.RawPath = ""
			r.RequestURI = r.URL.RequestURI()
		}
		next.ServeHTTP(w, r)
	})
}
