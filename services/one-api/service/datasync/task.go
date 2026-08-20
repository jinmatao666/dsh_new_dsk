package datasync

import (
	"sync"

	"github.com/songquanpeng/one-api/common/random"
)

// 任务状态
const (
	TaskRunning   = "running"
	TaskSucceeded = "succeeded"
	TaskFailed    = "failed"
	TaskPartial   = "partial" // 部分表失败
)

// TableError 单表同步错误明细。
type TableError struct {
	Table string `json:"table"`
	Error string `json:"error"`
}

// Task 一次同步任务的进度（内存态，不持久化）。
type Task struct {
	Id          string       `json:"id"`
	Status      string       `json:"status"`
	Modules     []string     `json:"modules"`
	RangeMode   string       `json:"range_mode"`
	TotalTables int          `json:"total_tables"`
	DoneTables  int          `json:"done_tables"`
	CurrentTable string      `json:"current_table"`
	CurrentRows int          `json:"current_rows"` // 当前表已搬行数
	TotalRows   int          `json:"total_rows"`   // 全部表累计已搬行数
	Errors      []TableError `json:"errors"`
}

var (
	tasksMu sync.Mutex
	tasks   = map[string]*Task{}
)

// newTask 创建并登记一个 running 任务。
func newTask(modules []string, rangeMode string, totalTables int) *Task {
	t := &Task{
		Id:          random.GetUUID(),
		Status:      TaskRunning,
		Modules:     modules,
		RangeMode:   rangeMode,
		TotalTables: totalTables,
		Errors:      []TableError{},
	}
	tasksMu.Lock()
	tasks[t.Id] = t
	tasksMu.Unlock()
	return t
}

// GetTask 按 id 取任务快照（拷贝，避免并发读写竞争）。
func GetTask(id string) (Task, bool) {
	tasksMu.Lock()
	defer tasksMu.Unlock()
	t, ok := tasks[id]
	if !ok {
		return Task{}, false
	}
	return *t, true
}

// RunningTaskExists 是否已有任务在跑（同一时间只允许一个）。
func RunningTaskExists() bool {
	tasksMu.Lock()
	defer tasksMu.Unlock()
	for _, t := range tasks {
		if t.Status == TaskRunning {
			return true
		}
	}
	return false
}

// CountTables 统计选中模块包含的表总数。
func CountTables(moduleKeys []string) int {
	n := 0
	for _, key := range moduleKeys {
		if m, ok := findModule(key); ok {
			n += len(m.Tables)
		}
	}
	return n
}

// StartSync 创建任务并在独立 goroutine 中执行；onDone 在任务结束后调用（已是终态快照）。
func StartSync(moduleKeys []string, r RangeSpec, totalTables int, onDone func(*Task)) *Task {
	t := newTask(moduleKeys, r.Mode, totalTables)
	go func() {
		Run(t, moduleKeys, r)
		if onDone != nil {
			onDone(t)
		}
	}()
	return t
}

// 以下 update* 在锁内更新任务进度。
func (t *Task) setCurrentTable(name string) {
	tasksMu.Lock()
	t.CurrentTable = name
	t.CurrentRows = 0
	tasksMu.Unlock()
}

func (t *Task) addRows(n int) {
	tasksMu.Lock()
	t.CurrentRows += n
	t.TotalRows += n
	tasksMu.Unlock()
}

func (t *Task) finishTable() {
	tasksMu.Lock()
	t.DoneTables++
	tasksMu.Unlock()
}

func (t *Task) addError(table string, err error) {
	tasksMu.Lock()
	t.Errors = append(t.Errors, TableError{Table: table, Error: err.Error()})
	tasksMu.Unlock()
}

func (t *Task) finish() {
	tasksMu.Lock()
	if len(t.Errors) > 0 {
		if t.DoneTables > len(t.Errors) {
			t.Status = TaskPartial
		} else {
			t.Status = TaskFailed
		}
	} else {
		t.Status = TaskSucceeded
	}
	t.CurrentTable = ""
	tasksMu.Unlock()
}
