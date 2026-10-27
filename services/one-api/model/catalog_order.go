package model

import (
	"errors"
	"strconv"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CatalogOrder keeps administrator and desktop catalogs in the same order.
// Explicit numbers precede empty values; creation time breaks ties.
func CatalogOrder(prefix string) string {
	return "CASE WHEN " + prefix + "sort_order IS NULL THEN 1 ELSE 0 END ASC, " + prefix + "sort_order DESC, " + prefix + "created_at DESC"
}

// MigrateCatalogMetadata initializes unknown legacy creation dates once.
// The new internet columns use a database default so existing rows become true;
// subsequent migrations preserve an explicitly saved false value.
func MigrateCatalogMetadata() error {
	return DB.Model(&ExpertWebProfile{}).Where("created_at IS NULL OR created_at = 0").UpdateColumn("created_at", gorm.Expr("updated_at")).Error
}

// MoveCatalogItem persists a drag or arrow move, including items outside the current page.
func MoveCatalogItem(kind, key, target string, after bool) error {
	tables := map[string]string{"skills": "skills", "skill-categories": "skill_categories", "experts": "expert_web_profiles", "expert-categories": "expert_categories"}
	table, ok := tables[kind]
	if !ok || key == "" || target == "" || key == target {
		return errors.New("排序参数无效")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		// 锁住完整列表，避免两位管理员同时拖动时互相覆盖。
		var rows []struct {
			Id  uint64
			Key string
		}
		column := "id"
		if kind == "experts" {
			column = "key"
		}
		query := tx.Table(table).Clauses(clause.Locking{Strength: "UPDATE"})
		if kind == "skills" || kind == "skill-categories" {
			query = query.Where("is_deleted = ?", false)
		}
		if err := query.Order(CatalogOrder("")).Order(clause.OrderByColumn{Column: clause.Column{Name: column}, Desc: true}).Find(&rows).Error; err != nil {
			return err
		}
		ids := make([]string, 0, len(rows))
		found, targetFound := false, false
		for _, row := range rows {
			id := row.Key
			if column == "id" {
				id = strconv.FormatUint(row.Id, 10)
			}
			if id == key {
				found = true
				continue
			}
			ids = append(ids, id)
			if id == target {
				targetFound = true
			}
		}
		if !found || !targetFound {
			return errors.New("排序对象不存在，请刷新列表")
		}
		for i, id := range ids {
			if id != target {
				continue
			}
			if after {
				i++
			}
			ids = append(ids, "")
			copy(ids[i+1:], ids[i:])
			ids[i] = key
			break
		}
		for i, id := range ids {
			if err := tx.Table(table).Where(clause.Eq{Column: column, Value: id}).Update("sort_order", len(ids)-i).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
