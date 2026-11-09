package controller

import (
	"encoding/json"
	"time"

	"github.com/songquanpeng/one-api/model"
)

const customCatalogEvent = "dsh_custom_model_catalog"
const customCallEvent = "dsh_custom_model_call"

type customModelEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type customModelRow struct {
	customModelEntry
	Configured bool  `json:"configured"`
	Calls      int   `json:"calls"`
	LastCall   int64 `json:"last_call"`
}

func sanitizeCustomModelEvent(event string, data map[string]interface{}) (string, bool) {
	raw, err := json.Marshal(data)
	if err != nil || len(raw) > 256000 {
		return "", false
	}
	valid := func(m customModelEntry) bool {
		return len(m.ID) > 0 && len([]rune(m.ID)) <= 256 && len([]rune(m.Name)) <= 256
	}
	var clean interface{}
	if event == customCatalogEvent {
		var catalog struct {
			Models []customModelEntry `json:"models"`
		}
		if json.Unmarshal(raw, &catalog) != nil || catalog.Models == nil || len(catalog.Models) > 200 {
			return "", false
		}
		for _, m := range catalog.Models {
			if !valid(m) {
				return "", false
			}
		}
		clean = catalog
	} else {
		var m customModelEntry
		if json.Unmarshal(raw, &m) != nil || !valid(m) {
			return "", false
		}
		clean = m
	}
	encoded, err := json.Marshal(clean)
	return string(encoded), err == nil
}

func customModelProfile(userID int) interface{} {
	var latest model.ClientEvent
	rows := []*customModelRow{}
	byID := map[string]*customModelRow{}
	var synced int64
	if model.DB.Where("user_id = ? AND event_name = ?", userID, customCatalogEvent).Order("id DESC").Limit(1).Find(&latest).Error == nil && latest.Id != 0 {
		var catalog struct {
			Models []customModelEntry `json:"models"`
		}
		if json.Unmarshal([]byte(latest.EventData), &catalog) == nil {
			synced = latest.CreatedAt.Unix()
			for _, m := range catalog.Models {
				if byID[m.ID] != nil {
					continue
				}
				row := &customModelRow{customModelEntry: m, Configured: true}
				rows = append(rows, row)
				byID[m.ID] = row
			}
		}
	}
	var calls []model.ClientEvent
	if model.DB.Select("event_data", "created_at").Where("user_id = ? AND event_name = ? AND created_at >= ?", userID, customCallEvent, time.Now().Add(-30*24*time.Hour)).Order("id DESC").Find(&calls).Error == nil {
		for _, call := range calls {
			var m customModelEntry
			if json.Unmarshal([]byte(call.EventData), &m) != nil || m.ID == "" {
				continue
			}
			row := byID[m.ID]
			if row == nil {
				row = &customModelRow{customModelEntry: m}
				rows = append(rows, row)
				byID[m.ID] = row
			}
			row.Calls++
			if ts := call.CreatedAt.Unix(); ts > row.LastCall {
				row.LastCall = ts
			}
		}
	}
	return map[string]interface{}{"synced_at": synced, "models": rows}
}
