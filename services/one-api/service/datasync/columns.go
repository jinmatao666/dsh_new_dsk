package datasync

import (
	"fmt"
	"sync"

	"gorm.io/gorm"
)

// columnCache 缓存 information_schema.columns 查询结果，键为 "库标识|表名"。
var (
	columnCacheMu sync.Mutex
	columnCache   = map[string][]string{}
)

// tableColumns 读取指定库指定表的列名（有序，按 ORDINAL_POSITION）。
func tableColumns(db *gorm.DB, schema, table, cacheKey string) ([]string, error) {
	columnCacheMu.Lock()
	if cols, ok := columnCache[cacheKey]; ok {
		columnCacheMu.Unlock()
		return cols, nil
	}
	columnCacheMu.Unlock()

	var cols []string
	err := db.Raw(
		`SELECT COLUMN_NAME FROM information_schema.columns
		 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		 ORDER BY ORDINAL_POSITION`, schema, table).Scan(&cols).Error
	if err != nil {
		return nil, err
	}
	columnCacheMu.Lock()
	columnCache[cacheKey] = cols
	columnCacheMu.Unlock()
	return cols, nil
}

// columnIntersection 取源库与目标库同一张表的列交集（保持源库列顺序）。
// 本地代码 migration 常领先线上，两侧列可能不一致，只搬两边都有的列。
func columnIntersection(src, dst *gorm.DB, srcSchema, dstSchema, table string) ([]string, error) {
	srcCols, err := tableColumns(src, srcSchema, table, "src|"+srcSchema+"|"+table)
	if err != nil {
		return nil, fmt.Errorf("读取源库列失败: %w", err)
	}
	dstCols, err := tableColumns(dst, dstSchema, table, "dst|"+dstSchema+"|"+table)
	if err != nil {
		return nil, fmt.Errorf("读取目标库列失败: %w", err)
	}
	dstSet := map[string]bool{}
	for _, c := range dstCols {
		dstSet[c] = true
	}
	var inter []string
	for _, c := range srcCols {
		if dstSet[c] {
			inter = append(inter, c)
		}
	}
	return inter, nil
}

// clearColumnCache 清空列缓存（测试用，或源/目标库切换时）。
func clearColumnCache() {
	columnCacheMu.Lock()
	columnCache = map[string][]string{}
	columnCacheMu.Unlock()
}
