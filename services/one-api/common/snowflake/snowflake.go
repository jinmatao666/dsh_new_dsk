package snowflake

import (
	"sync"

	"github.com/bwmarrin/snowflake"
)

// 账号中心等需要 MySQL/PostgreSQL 双兼容的主键统一用雪花值（int64）。
// 雪花值两库都用 bigint 存储，无方言差异，且分布式生成、多实例不撞。

var (
	node     *snowflake.Node
	initOnce sync.Once
	initErr  error
)

// Init 在进程启动时调用一次。nodeID 取值 0-1023，多实例部署时各实例须不同，
// 否则可能生成重复 ID。重复调用只有首次生效。
func Init(nodeID int64) error {
	initOnce.Do(func() {
		node, initErr = snowflake.NewNode(nodeID)
	})
	return initErr
}

// NextID 生成全局唯一雪花 ID。
// 若 Init 尚未调用（例如启动顺序异常 / 测试场景遗漏），自动用 nodeID=0 兜底初始化，
// 避免热路径 panic 影响线上稳定性。多实例部署仍应在启动期显式调 Init 设置不同 nodeID。
func NextID() int64 {
	if node == nil {
		_ = Init(0)
	}
	return node.Generate().Int64()
}
