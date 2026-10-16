package datasync

// ModuleStatus 模块清单项（含源库各表行数），供 status 接口前端渲染。
type ModuleStatus struct {
	Key          string             `json:"key"`
	Name         string             `json:"name"`
	SupportsRange bool              `json:"supports_range"`
	Tables       []TableStatus      `json:"tables"`
	TotalRows    int64              `json:"total_rows"`
}

// TableStatus 模块内单表状态。
type TableStatus struct {
	Name      string `json:"name"`
	HasTime   bool   `json:"has_time"`
	SourceRows int64 `json:"source_rows"`
}

// FullStatus status 接口完整返回。
type FullStatus struct {
	StatusInfo
	Modules []ModuleStatus `json:"modules"`
}

// Status 返回安全检测结果 + 模块清单（可用时附带源库各表行数）。
func Status() FullStatus {
	fs := FullStatus{StatusInfo: CheckEnabled(), Modules: []ModuleStatus{}}

	for _, m := range modules {
		ms := ModuleStatus{
			Key:           m.Key,
			Name:          m.Name,
			SupportsRange: m.SupportsRange(),
			Tables:        []TableStatus{},
		}
		for _, t := range m.Tables {
			ts := TableStatus{Name: t.Name, HasTime: t.TimeKind != TimeKindNone}
			// 仅功能可用时查源库行数，避免连不上时拖慢/报错
			if fs.Enabled {
				if src, err := sourceDB(); err == nil {
					var c int64
					if src.Table(t.Name).Count(&c).Error == nil {
						ts.SourceRows = c
						ms.TotalRows += c
					}
				}
			}
			ms.Tables = append(ms.Tables, ts)
		}
		fs.Modules = append(fs.Modules, ms)
	}
	return fs
}
