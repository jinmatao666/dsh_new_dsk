package datasync

import (
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
)

// TablePreview 单表预览统计。
type TablePreview struct {
	Module     string `json:"module"`
	Table      string `json:"table"`
	SyncRows   int64  `json:"sync_rows"`   // 将从源库同步的行数
	TargetRows int64  `json:"target_rows"` // 目标表当前行数（将被清空）
}

// PreviewResult 预览结果。
type PreviewResult struct {
	Tables    []TablePreview `json:"tables"`
	TotalSync int64          `json:"total_sync"`
}

// Preview 对选中模块的每张表，按范围算源库将同步行数 + 目标表现有行数。
func Preview(moduleKeys []string, r RangeSpec) (*PreviewResult, error) {
	src, err := sourceDB()
	if err != nil {
		return nil, err
	}
	dst := model.DB

	res := &PreviewResult{Tables: []TablePreview{}}
	for _, key := range moduleKeys {
		m, ok := findModule(key)
		if !ok {
			continue
		}
		for _, t := range m.Tables {
			tp := TablePreview{Module: m.Key, Table: t.Name}

			syncCount, err := countSyncRows(t, r)
			if err != nil {
				return nil, err
			}
			tp.SyncRows = syncCount

			// 目标表当前行数
			var tgtCount int64
			_ = dst.Table(t.Name).Count(&tgtCount).Error
			tp.TargetRows = tgtCount

			res.Tables = append(res.Tables, tp)
			res.TotalSync += syncCount
		}
	}
	_ = src
	return res, nil
}

// countSyncRows 算单表将同步的行数。latest_n 单独处理：GORM Count 会剥掉 LIMIT，
// 故 latest_n 取 min(n, 全表满足条件行数)。
func countSyncRows(t TableSpec, r RangeSpec) (int64, error) {
	src, err := sourceDB()
	if err != nil {
		return 0, err
	}
	if t.Primary && t.TimeKind != TimeKindNone && r.Mode == RangeLatestN {
		var total int64
		if err := src.Table(t.Name).Count(&total).Error; err != nil {
			return 0, err
		}
		n := int64(r.Count)
		if n <= 0 {
			n = 1000
		}
		if total < n {
			return total, nil
		}
		return n, nil
	}
	q := applyRange(src.Table(t.Name), t, r)
	var c int64
	if err := q.Count(&c).Error; err != nil {
		return 0, err
	}
	return c, nil
}

// sourceSchema 解析源库库名。
func sourceSchema() string {
	d, _ := parseMySQLDSN(config.SyncSourceDSN)
	return d.DB
}
