package datasync

import "testing"

func TestParseMySQLDSN(t *testing.T) {
	cases := []struct {
		dsn      string
		ok       bool
		user     string
		host     string
		db       string
		identity string
	}{
		{
			dsn:      "oneapi:secret@tcp(47.110.42.93:101)/oneapi_letty",
			ok:       true,
			user:     "oneapi",
			host:     "47.110.42.93:101",
			db:       "oneapi_letty",
			identity: "47.110.42.93:101/oneapi_letty",
		},
		{
			dsn:      "oneapi:secret@tcp(47.110.42.93:101)/oneapi?charset=utf8mb4&parseTime=True",
			ok:       true,
			user:     "oneapi",
			host:     "47.110.42.93:101",
			db:       "oneapi",
			identity: "47.110.42.93:101/oneapi",
		},
		{dsn: "postgres://u:p@host:5432/db", ok: false},
		{dsn: "", ok: false},
	}
	for _, c := range cases {
		got, ok := parseMySQLDSN(c.dsn)
		if ok != c.ok {
			t.Fatalf("parseMySQLDSN(%q) ok=%v want %v", c.dsn, ok, c.ok)
		}
		if !ok {
			continue
		}
		if got.User != c.user || got.Host != c.host || got.DB != c.db {
			t.Errorf("parseMySQLDSN(%q) = %+v", c.dsn, got)
		}
		if got.identity() != c.identity {
			t.Errorf("identity(%q) = %q want %q", c.dsn, got.identity(), c.identity)
		}
	}
}

func TestDSNIdentitySameLibDifferentParams(t *testing.T) {
	// 同库不同连接参数应归一化为相同 identity（用于源==目标判定）
	a, _ := parseMySQLDSN("oneapi:p1@tcp(h:1)/oneapi?parseTime=True")
	b, _ := parseMySQLDSN("oneapi:p2@tcp(h:1)/oneapi?charset=utf8mb4")
	if a.identity() != b.identity() {
		t.Errorf("same lib should match: %q vs %q", a.identity(), b.identity())
	}
}

func TestMaskedHidesPassword(t *testing.T) {
	d, _ := parseMySQLDSN("oneapi:supersecret@tcp(h:1)/db")
	m := d.masked()
	if m != "oneapi@h:1/db" {
		t.Errorf("masked = %q", m)
	}
	if contains(m, "supersecret") {
		t.Errorf("masked leaks password: %q", m)
	}
}

func TestEnsureMySQLParams(t *testing.T) {
	out := ensureMySQLParams("u:p@tcp(h:1)/db")
	if !contains(out, "parseTime=True") || !contains(out, "loc=") {
		t.Errorf("ensureMySQLParams missing params: %q", out)
	}
	// 已有参数不重复追加
	out2 := ensureMySQLParams("u:p@tcp(h:1)/db?parseTime=True&loc=UTC")
	if countSub(out2, "parseTime=") != 1 {
		t.Errorf("parseTime duplicated: %q", out2)
	}
}

func TestApplyRangeSkipsNonPrimaryAndNoTime(t *testing.T) {
	// 关联小表/无时间字段表不应被范围模式改写（这里只验证 spec 判定分支）
	if (TableSpec{Name: "abilities", TimeKind: TimeKindNone}).Primary {
		t.Error("abilities should not be primary")
	}
	m, ok := findModule("channels")
	if !ok {
		t.Fatal("channels module missing")
	}
	if !m.SupportsRange() {
		t.Error("channels should support range (has primary timed table)")
	}
	opt, _ := findModule("options")
	if opt.SupportsRange() {
		t.Error("options should not support range")
	}
}

func TestCountTables(t *testing.T) {
	n := CountTables([]string{"options", "logs"})
	if n != 2 {
		t.Errorf("CountTables = %d want 2", n)
	}
	if CountTables([]string{"nonexistent"}) != 0 {
		t.Error("unknown module should count 0")
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

func countSub(s, sub string) int {
	n := 0
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			n++
		}
	}
	return n
}
