package datasync

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

// dsnInfo 从 MySQL DSN 解析出的关键标识，用于归一化比对与脱敏展示。
type dsnInfo struct {
	User string
	Host string // host:port
	DB   string
}

// mysqlDSNRe 匹配 user:pass@tcp(host:port)/dbname?params 形式。
var mysqlDSNRe = regexp.MustCompile(`^([^:]+):[^@]*@tcp\(([^)]+)\)/([^?]+)`)

// parseMySQLDSN 解析 MySQL DSN，非该形式返回 ok=false。
func parseMySQLDSN(dsn string) (dsnInfo, bool) {
	m := mysqlDSNRe.FindStringSubmatch(dsn)
	if m == nil {
		return dsnInfo{}, false
	}
	return dsnInfo{User: m[1], Host: m[2], DB: m[3]}, true
}

// identity 归一化标识 host:port/db，用于源库/目标库是否同库的比对。
func (d dsnInfo) identity() string {
	return strings.ToLower(d.Host + "/" + d.DB)
}

// masked 脱敏展示（去掉密码）：user@host/db。
func (d dsnInfo) masked() string {
	if d.User == "" {
		return d.Host + "/" + d.DB
	}
	return d.User + "@" + d.Host + "/" + d.DB
}

// ensureMySQLParams 补齐 parseTime/loc 参数，与 model.openMySQL 行为对齐。
func ensureMySQLParams(dsn string) string {
	if !strings.Contains(dsn, "parseTime=") {
		if strings.Contains(dsn, "?") {
			dsn += "&parseTime=True"
		} else {
			dsn += "?parseTime=True"
		}
	}
	if !strings.Contains(dsn, "loc=") {
		dsn += "&loc=Asia%2FShanghai"
	}
	return dsn
}

// currentDBName 取目标库（当前服务连接的库）的库名。
func currentDBName(db *gorm.DB) string {
	var name string
	db.Raw("SELECT DATABASE()").Scan(&name)
	return name
}

// prodDBNameSet 解析守护清单为小写集合。
func prodDBNameSet() map[string]bool {
	set := map[string]bool{}
	for _, n := range strings.Split(config.SyncProdDBNames, ",") {
		n = strings.TrimSpace(strings.ToLower(n))
		if n != "" {
			set[n] = true
		}
	}
	return set
}

// StatusInfo 同步功能状态，供 GET /api/sync/status 返回。
type StatusInfo struct {
	Enabled       bool   `json:"enabled"`
	DisabledReason string `json:"disabled_reason,omitempty"`
	// 目标库（当前服务连接）
	TargetDB       string `json:"target_db"`
	TargetIsolated bool   `json:"target_isolated"` // 是否隔离库（不在守护清单）
	// 源库（线上）
	SourceConfigured bool   `json:"source_configured"`
	SourceConnected  bool   `json:"source_connected"`
	SourceMasked     string `json:"source_masked,omitempty"`
	SourceDB         string `json:"source_db,omitempty"`
	SourceVersion    string `json:"source_version,omitempty"`
	SourceError      string `json:"source_error,omitempty"`
}

// CheckEnabled 执行安全检测，返回功能是否可用 + 状态详情。
// 同一函数供 status 展示与 execute 兜底两处调用，后端兜底不依赖前端禁用。
func CheckEnabled() StatusInfo {
	info := StatusInfo{}

	// 目标库方言必须是 MySQL（第一期只支持 MySQL→MySQL）
	if model.DB == nil || model.DB.Dialector.Name() != "mysql" {
		info.Enabled = false
		info.DisabledReason = "第一期仅支持 MySQL 目标库，当前目标库非 MySQL，同步功能不可用"
		return info
	}

	target := currentDBName(model.DB)
	info.TargetDB = target
	prodSet := prodDBNameSet()
	targetIsProd := prodSet[strings.ToLower(target)]
	info.TargetIsolated = !targetIsProd

	// 守护清单：当前库命中清单 → 锁死（即使源 DSN 配错也兜底）
	if targetIsProd {
		info.Enabled = false
		info.DisabledReason = fmt.Sprintf("当前服务连接的是线上库 %s，同步功能已锁定（防止反向污染线上数据）", target)
		return info
	}

	// 源库 DSN 必须配置
	if config.SyncSourceDSN == "" {
		info.Enabled = false
		info.DisabledReason = "未配置 SYNC_SOURCE_SQL_DSN，无法获取线上源库连接"
		return info
	}
	info.SourceConfigured = true

	srcDSN, ok := parseMySQLDSN(config.SyncSourceDSN)
	if !ok {
		info.Enabled = false
		info.DisabledReason = "SYNC_SOURCE_SQL_DSN 格式无法解析（仅支持 MySQL DSN）"
		return info
	}
	info.SourceMasked = srcDSN.masked()
	info.SourceDB = srcDSN.DB

	// DSN 归一化比对：源==目标 → 当前连的就是源库本身，禁用
	if tgtDSN, ok := parseMySQLDSN(rawTargetDSN()); ok {
		if tgtDSN.identity() == srcDSN.identity() {
			info.Enabled = false
			info.DisabledReason = fmt.Sprintf("源库与目标库为同一个库 %s，同步无意义且危险，已禁用", srcDSN.masked())
			return info
		}
	}

	// 源库连通性检测
	sdb, err := sourceDB()
	if err != nil {
		info.SourceConnected = false
		info.SourceError = err.Error()
		info.Enabled = false
		info.DisabledReason = "线上源库连接失败：" + err.Error()
		return info
	}
	var version string
	if err := sdb.Raw("SELECT VERSION()").Scan(&version).Error; err != nil {
		info.SourceConnected = false
		info.SourceError = err.Error()
		info.Enabled = false
		info.DisabledReason = "线上源库 ping 失败：" + err.Error()
		return info
	}
	info.SourceConnected = true
	info.SourceVersion = version
	info.Enabled = true
	return info
}

// rawTargetDSN 返回当前主业务库 DSN（用于 DSN 比对）。可在测试中替换。
var rawTargetDSN = func() string {
	return os.Getenv("SQL_DSN")
}
