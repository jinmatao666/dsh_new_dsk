package datasync

import (
	"errors"
	"sync"

	"github.com/songquanpeng/one-api/common/config"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var (
	sourceOnce sync.Once
	sourceConn *gorm.DB
	sourceErr  error
)

// sourceDB 惰性建立线上源库连接（只读用途）。连接池上限设小，避免对线上库造成压力。
func sourceDB() (*gorm.DB, error) {
	sourceOnce.Do(func() {
		dsn := config.SyncSourceDSN
		if dsn == "" {
			sourceErr = errors.New("未配置 SYNC_SOURCE_SQL_DSN")
			return
		}
		dsn = ensureMySQLParams(dsn)
		db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
			Logger: gormlogger.Default.LogMode(gormlogger.Silent),
		})
		if err != nil {
			sourceErr = err
			return
		}
		sqlDB, err := db.DB()
		if err != nil {
			sourceErr = err
			return
		}
		sqlDB.SetMaxOpenConns(4)
		sqlDB.SetMaxIdleConns(2)
		sourceConn = db
	})
	return sourceConn, sourceErr
}

// resetSourceForTest 仅供测试重置惰性连接缓存。
func resetSourceForTest() {
	sourceOnce = sync.Once{}
	sourceConn = nil
	sourceErr = nil
}
