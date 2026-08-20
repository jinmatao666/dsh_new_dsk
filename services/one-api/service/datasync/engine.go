package datasync

import (
	"fmt"

	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

const batchSize = 1000

// Run 执行一次同步任务（在独立 goroutine 中调用）。
// 按模块顺序逐表执行：取列交集 → 事务内清空目标表 → 源库分批读 → 批量写。
// 单表失败回滚该表、记错、继续，终态由 task.finish() 判定。
func Run(t *Task, moduleKeys []string, r RangeSpec) {
	defer func() {
		if rec := recover(); rec != nil {
			t.addError("<panic>", fmt.Errorf("%v", rec))
		}
		t.finish()
	}()

	src, err := sourceDB()
	if err != nil {
		t.addError("<source>", err)
		return
	}
	srcSchema := sourceSchema()
	dstSchema := currentDBName(model.DB)

	for _, key := range moduleKeys {
		m, ok := findModule(key)
		if !ok {
			continue
		}
		for _, spec := range m.Tables {
			t.setCurrentTable(spec.Name)
			if err := syncTable(t, src, model.DB, srcSchema, dstSchema, spec, r); err != nil {
				logger.SysErrorf("data sync: 表 %s 同步失败: %v", spec.Name, err)
				t.addError(spec.Name, err)
			}
			t.finishTable()
		}
	}
}

// syncTable 同步单张表。整表在一个事务内完成：先清空目标表，再分批插入。
func syncTable(t *Task, src, dst *gorm.DB, srcSchema, dstSchema string, spec TableSpec, r RangeSpec) error {
	cols, err := columnIntersection(src, dst, srcSchema, dstSchema, spec.Name)
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return fmt.Errorf("源库与目标库无公共列")
	}

	return dst.Transaction(func(tx *gorm.DB) error {
		// 清空目标表
		if err := tx.Exec("DELETE FROM " + quoteIdent(spec.Name)).Error; err != nil {
			return fmt.Errorf("清空目标表失败: %w", err)
		}
		// 源库读取查询（带范围 + 主键排序，分页用 id 游标）
		return readAndInsert(t, src, tx, spec, cols, r)
	})
}

// readAndInsert 从源库按 id 游标分批读取列交集数据，批量写入目标库事务。
func readAndInsert(t *Task, src *gorm.DB, tx *gorm.DB, spec TableSpec, cols []string, r RangeSpec) error {
	selectCols := make([]string, len(cols))
	for i, c := range cols {
		selectCols[i] = quoteIdent(c)
	}
	hasID := containsCol(cols, "id")

	// latest_n: 先取最近 n 行的 id 集合，再按 id 搬（避免游标分页与 LIMIT 冲突）
	if spec.Primary && spec.TimeKind != TimeKindNone && r.Mode == RangeLatestN {
		return insertLatestN(t, src, tx, spec, selectCols, r)
	}

	// 无 id 列的表（如 abilities / user_tag_relations）：一次性全读，再分批写入。
	// 这类表始终全量，行数可能不小但远低于带 id 的主表。
	if !hasID {
		rows, err := scanRows(applyRange(src.Table(spec.Name).Select(selectCols), spec, r))
		if err != nil {
			return err
		}
		return insertInChunks(t, tx, spec.Name, rows)
	}

	var lastID int64 = 0
	for {
		q := src.Table(spec.Name).Select(selectCols)
		q = applyRange(q, spec, r)
		q = q.Where("id > ?", lastID).Order("id ASC").Limit(batchSize)
		rows, err := scanRows(q)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			break
		}
		if err := tx.Table(spec.Name).Create(&rows).Error; err != nil {
			return fmt.Errorf("写入失败: %w", err)
		}
		t.addRows(len(rows))
		if len(rows) < batchSize {
			break
		}
		lastID = toInt64(rows[len(rows)-1]["id"])
	}
	return nil
}

// insertInChunks 把整批行按 batchSize 分块写入。
func insertInChunks(t *Task, tx *gorm.DB, table string, rows []map[string]interface{}) error {
	for i := 0; i < len(rows); i += batchSize {
		end := i + batchSize
		if end > len(rows) {
			end = len(rows)
		}
		chunk := rows[i:end]
		if err := tx.Table(table).Create(&chunk).Error; err != nil {
			return fmt.Errorf("写入失败: %w", err)
		}
		t.addRows(len(chunk))
	}
	return nil
}

// insertLatestN 同步最近 N 条：按时间字段 DESC LIMIT n 取数据后写入。
func insertLatestN(t *Task, src *gorm.DB, tx *gorm.DB, spec TableSpec, selectCols []string, r RangeSpec) error {
	n := r.Count
	if n <= 0 {
		n = 1000
	}
	q := src.Table(spec.Name).Select(selectCols).
		Order(spec.TimeField + " DESC").Limit(n)
	rows, err := scanRows(q)
	if err != nil {
		return err
	}
	return insertInChunks(t, tx, spec.Name, rows)
}

// scanRows 执行查询并以 []map 形式返回（仅含选中列）。
func scanRows(q *gorm.DB) ([]map[string]interface{}, error) {
	var rows []map[string]interface{}
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func containsCol(cols []string, name string) bool {
	for _, c := range cols {
		if c == name {
			return true
		}
	}
	return false
}

func toInt64(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case int32:
		return int64(n)
	case uint64:
		return int64(n)
	case float64:
		return int64(n)
	default:
		return 0
	}
}

// quoteIdent MySQL 反引号转义标识符。
func quoteIdent(name string) string {
	return "`" + name + "`"
}
