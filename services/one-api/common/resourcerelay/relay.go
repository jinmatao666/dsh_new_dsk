// Package resourcerelay forwards bounded TCP streams over authenticated WebSockets.
// The caller owns authentication; HTTPS remains end-to-end and is never decrypted.
package resourcerelay

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// Limits applies to each accepted connection and the service-wide admission pool.
type Limits struct {
	Connections int
	PerUser     int
	Bytes       int64
	Idle        time.Duration
	Lifetime    time.Duration
}

// EnvironmentLimits reads deployment-owned limits; malformed values fail closed.
func EnvironmentLimits() (Limits, error) {
	values := []int64{64, 8, 1 << 30, 90, 3600}
	for i, key := range []string{"DSH_RELAY_CONNECTIONS", "DSH_RELAY_PER_USER", "DSH_RELAY_BYTES", "DSH_RELAY_IDLE_SECONDS", "DSH_RELAY_LIFETIME_SECONDS"} {
		if raw := os.Getenv(key); raw != "" {
			n, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || n <= 0 || n > 1<<40 {
				return Limits{}, fmt.Errorf("invalid %s", key)
			}
			values[i] = n
		}
	}
	if values[0] > 4096 || values[1] > values[0] || values[3] > 86400 || values[4] > 86400 {
		return Limits{}, fmt.Errorf("invalid relay connection/time limits")
	}
	return Limits{int(values[0]), int(values[1]), values[2], time.Duration(values[3]) * time.Second, time.Duration(values[4]) * time.Second}, nil
}

var reserved = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("168.63.129.16/32"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2001::/32"), netip.MustParsePrefix("2002::/16"), netip.MustParsePrefix("64:ff9b::/96"),
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range reserved {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

// DialPublic resolves once, rejects the complete answer set if any IP is private,
// then dials an approved literal address so DNS rebinding cannot change the target.
func DialPublic(ctx context.Context, host, port string) (net.Conn, error) {
	if host == "" || (port != "80" && port != "443") {
		return nil, fmt.Errorf("only public HTTP(S) targets are allowed")
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(addresses) == 0 {
		return nil, fmt.Errorf("target DNS failed")
	}
	for _, ip := range addresses {
		if !publicIP(ip) {
			return nil, fmt.Errorf("private or reserved target denied")
		}
	}
	var last error
	for _, ip := range addresses {
		conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	return nil, last
}

// Service owns active-connection limits. All requests must share one instance.
type Service struct {
	mu    sync.Mutex
	users map[int]int
	total int
}

// New creates a service with no active tunnels.
func New() *Service { return &Service{users: make(map[int]int)} }

func (s *Service) acquire(user int, limits Limits) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.total >= limits.Connections || s.users[user] >= limits.PerUser {
		return false
	}
	s.total++
	s.users[user]++
	return true
}
func (s *Service) release(user int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.total--
	s.users[user]--
	if s.users[user] == 0 {
		delete(s.users, user)
	}
}

// Serve admits an already-authenticated user. Only binary frames carry target data.
// Cancellation, limits or either peer closing tears down and joins both directions.
func (s *Service) Serve(w http.ResponseWriter, r *http.Request, user int, limits Limits) {
	s.serve(w, r, user, limits, DialPublic)
}

func (s *Service) serve(w http.ResponseWriter, r *http.Request, user int, limits Limits, dial func(context.Context, string, string) (net.Conn, error)) {
	if user <= 0 || r.Header.Get("Authorization") == "" || r.Header.Get("Origin") != "" {
		http.Error(w, "desktop authentication required", http.StatusForbidden)
		return
	}
	if !websocket.IsWebSocketUpgrade(r) {
		http.Error(w, "WebSocket required", http.StatusBadRequest)
		return
	}
	if !s.acquire(user, limits) {
		http.Error(w, "relay busy", http.StatusTooManyRequests)
		return
	}
	defer s.release(user)
	host, port := r.URL.Query().Get("host"), r.URL.Query().Get("port")
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	target, err := dial(ctx, host, port)
	cancel()
	if err != nil {
		http.Error(w, "target unavailable or denied", http.StatusBadGateway)
		return
	}
	defer target.Close()
	upgrader := websocket.Upgrader{HandshakeTimeout: 5 * time.Second, ReadBufferSize: 32 << 10, WriteBufferSize: 32 << 10}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()
	ws.SetReadLimit(64 << 10)
	if err = ws.WriteMessage(websocket.TextMessage, []byte(`{"ready":true}`)); err != nil {
		return
	}
	var transferred atomic.Int64
	touch := func() { _ = ws.SetReadDeadline(time.Now().Add(limits.Idle)) }
	touch()
	ws.SetPongHandler(func(string) error { touch(); return nil })
	done := make(chan struct{}, 2)
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			kind, data, err := ws.ReadMessage()
			if err != nil || kind != websocket.BinaryMessage || transferred.Add(int64(len(data))) > limits.Bytes {
				return
			}
			touch()
			_ = target.SetWriteDeadline(time.Now().Add(limits.Idle))
			if _, err = io.Copy(target, bytes.NewReader(data)); err != nil {
				return
			}
		}
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 32<<10)
		for {
			_ = target.SetReadDeadline(time.Now().Add(limits.Idle))
			n, err := target.Read(buf)
			if n > 0 {
				if transferred.Add(int64(n)) > limits.Bytes {
					return
				}
				_ = ws.SetWriteDeadline(time.Now().Add(limits.Idle))
				if writeErr := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); writeErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(limits.Idle / 3)
	defer ticker.Stop()
	timer := time.NewTimer(limits.Lifetime)
	defer timer.Stop()
	finished := 0
run:
	for {
		select {
		case <-done:
			finished++
			break run
		case <-r.Context().Done():
			break run
		case <-timer.C:
			break run
		case <-ticker.C:
			if ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				break run
			}
		}
	}
	_ = target.Close()
	_ = ws.Close()
	for finished < 2 {
		<-done
		finished++
	}
	log.Printf("resource-relay user=%d target=%s bytes=%d", user, net.JoinHostPort(host, port), transferred.Load())
}
