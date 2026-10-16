package datasync

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// 范围模式
const (
	RangeAll       = "all"        // 全量
	RangeTimeRange = "time_range" // 按时间区间
	RangeLatestN   = "latest_n"   // 最近 N 条
)

// RangeSpec 同步范围参数。
type RangeSpec struct {
	Mode  string `json:"mode"`
	Start int64  `json:"start"` // time_range 起（Unix 秒）
	End   int64  `json:"end"`   // time_range 止（Unix 秒）
	Count int    `json:"count"` // latest_n 条数
}

// applyRange 把范围模式应用到查询。
// 仅对带时间字段的主表生效；关联小表（TimeKindNone 或非主表）始终全量。
// latest_n 通过 ORDER BY 时间字段 DESC LIMIT n 实现。
func applyRange(q *gorm.DB, t TableSpec, r RangeSpec) *gorm.DB {
	if !t.Primary || t.TimeKind == TimeKindNone {
		return q // 小表全量
	}
	switch r.Mode {
	case RangeTimeRange:
		startVal, endVal := timeBounds(t.TimeKind, r.Start, r.End)
		q = q.Where(fmt.Sprintf("%s >= ? AND %s <= ?", t.TimeField, t.TimeField), startVal, endVal)
	case RangeLatestN:
		n := r.Count
		if n <= 0 {
			n = 1000
		}
		q = q.Order(t.TimeField + " DESC").Limit(n)
	}
	return q
}

// timeBounds 按时间字段风格把 Unix 秒区间翻译成查询值。
func timeBounds(kind int, start, end int64) (interface{}, interface{}) {
	switch kind {
	case TimeKindUnixSec:
		return start, end
	case TimeKindDateTime:
		return time.Unix(start, 0), time.Unix(end, 0)
	default:
		return start, end
	}
}
