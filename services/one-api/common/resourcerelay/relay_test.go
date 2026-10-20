package resourcerelay

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func limits() Limits {
	return Limits{Connections: 2, PerUser: 1, Bytes: 1024, Idle: time.Second, Lifetime: 5 * time.Second}
}

func TestPublicTargetPolicy(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2002:a00:1::1", "64:ff9b::a00:1", "198.18.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "168.63.129.16", "4000::1"} {
		if publicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("allowed %s", raw)
		}
	}
	for _, raw := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		if !publicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("denied %s", raw)
		}
	}
	for _, target := range [][2]string{{"127.0.0.1", "443"}, {"localhost", "80"}, {"example.com", "5432"}} {
		if conn, err := DialPublic(context.Background(), target[0], target[1]); err == nil {
			conn.Close()
			t.Fatal("private/invalid target dialed")
		}
	}
}

func TestEnvironmentLimits(t *testing.T) {
	t.Setenv("DSH_RELAY_BYTES", "10000")
	l, err := EnvironmentLimits()
	if err != nil || l.Bytes != 10000 {
		t.Fatal(l, err)
	}
	for _, raw := range []string{"bad", "0", "-1"} {
		t.Setenv("DSH_RELAY_BYTES", raw)
		if _, err := EnvironmentLimits(); err == nil {
			t.Fatal("accepted invalid limit")
		}
	}
}

func TestBinaryTunnelAndAdmission(t *testing.T) {
	s := New()
	finished := make(chan struct{}, 4)
	dial := func(context.Context, string, string) (net.Conn, error) {
		server, peer := net.Pipe()
		go func() { defer peer.Close(); defer func() { finished <- struct{}{} }(); _, _ = io.Copy(peer, peer) }()
		return server, nil
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.serve(w, r, 1, limits(), dial) }))
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "?host=example.com&port=443"
	for _, headers := range []http.Header{nil, {"Authorization": []string{"Bearer fixture"}, "Origin": []string{"http://untrusted"}}} {
		conn, response, err := websocket.DefaultDialer.Dial(url, headers)
		if conn != nil {
			conn.Close()
		}
		if err == nil || response.StatusCode != 403 {
			t.Fatal("unauthenticated/browser request allowed")
		}
	}
	headers := http.Header{"Authorization": []string{"Bearer fixture"}}
	conn, _, err := websocket.DefaultDialer.Dial(url, headers)
	if err != nil {
		t.Fatal(err)
	}
	_, ready, err := conn.ReadMessage()
	if err != nil || string(ready) != `{"ready":true}` {
		t.Fatal(string(ready), err)
	}
	_, response, err := websocket.DefaultDialer.Dial(url, headers)
	if err == nil || response.StatusCode != 429 {
		t.Fatal("per-user limit missing")
	}
	for _, body := range []string{"hello", "second packet"} {
		if err = conn.WriteMessage(websocket.BinaryMessage, []byte(body)); err != nil {
			t.Fatal(err)
		}
		kind, echoed, err := conn.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage || string(echoed) != body {
			t.Fatal(string(echoed), err)
		}
	}
	_ = conn.WriteMessage(websocket.BinaryMessage, make([]byte, 1025))
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err = conn.ReadMessage(); err == nil {
		t.Fatal("byte limit missing")
	}
	conn.Close()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("target leaked")
	}
	deadline := time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		total := s.total
		s.mu.Unlock()
		if total == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("admission not released")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestDeniedTargetDoesNotUpgrade(t *testing.T) {
	s := New()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.Serve(w, r, 1, limits()) }))
	defer server.Close()
	_, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?host=127.0.0.1&port=443", http.Header{"Authorization": []string{"fixture"}})
	if err == nil || response.StatusCode != 502 {
		t.Fatal("private destination accepted")
	}
}

// Test adapter exposes WebSocket binary frames as a net.Conn for the real TLS client.
type wsConn struct {
	net.Conn
	ws      *websocket.Conn
	pending []byte
}

func (c *wsConn) Read(p []byte) (int, error) {
	if len(c.pending) == 0 {
		kind, body, err := c.ws.ReadMessage()
		if err != nil {
			return 0, err
		}
		if kind != websocket.BinaryMessage {
			return 0, fmt.Errorf("unexpected frame")
		}
		c.pending = body
	}
	n := copy(p, c.pending)
	c.pending = c.pending[n:]
	return n, nil
}
func (c *wsConn) Write(p []byte) (int, error) {
	err := c.ws.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

func TestHTTPSRemainsEndToEndAndVerifiesCertificate(t *testing.T) {
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "verified-https-resource") }))
	defer target.Close()
	s := New()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		l := limits()
		l.Bytes = 64 << 10
		s.serve(w, r, 1, l, func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", target.Listener.Addr().String())
		})
	}))
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(target.Certificate())
	for _, trust := range []bool{true, false} {
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?host=example.com&port=443", http.Header{"Authorization": []string{"fixture"}})
		if err != nil {
			t.Fatal(err)
		}
		_, _, _ = conn.ReadMessage()
		config := &tls.Config{ServerName: "example.com", MinVersion: tls.VersionTLS12}
		if trust {
			config.RootCAs = roots
		} else {
			config.RootCAs = x509.NewCertPool()
		}
		client := tls.Client(&wsConn{Conn: conn.UnderlyingConn(), ws: conn}, config)
		err = client.Handshake()
		if !trust {
			if err == nil {
				t.Fatal("untrusted certificate accepted")
			}
			conn.Close()
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(client, "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n")
		response, err := http.ReadResponse(bufio.NewReader(client), nil)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		if err != nil || string(body) != "verified-https-resource" {
			t.Fatal(string(body), err)
		}
		response.Body.Close()
		conn.Close()
	}
}
