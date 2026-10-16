# Parvis 积分两类化改造方案

日期: 2026-05-27
状态: PR1 + PR2 + PR3 已实施(后端 + 前端展示完成,等待生产部署)
作者: 协作设计

## 背景

当前 `users.quota` 单字段把所有积分来源混在一起,带来两个问题:
- VIP 套餐续期 (`model/subscription.go:155`) 直接 `Update("quota", totalQuota)`,会抹掉用户已有的兑换/充值/邀请奖励等永久余额。
- 业务上区分不出"按月清零的订阅积分"和"有独立到期时间的定时积分",无法做精细化运营。

## 1. 模型最终定义

| 类型 | 来源 | 时效语义 | 存储 |
|---|---|---|---|
| 订阅积分 subscription | VIP 套餐发放 / 每月免费(无 VIP 用户) | 周期性覆盖式发放,到期清零 | `users.subscription_quota` 单字段 |
| 定时积分 timed | 注册赠送 / 兑换码 / 在线充值 / 邀请 / 管理员 / 退款 | 每笔独立到期,可设永久(NULL) | 独立账本表多行 |

互斥规则保持现状: 用户有任何 active 订阅时,每月免费 cron 不发放; 订阅到期后下个 cron 自动恢复发放。`model/free_quota.go:42` 的 LEFT JOIN 过滤逻辑无需改动。

## 2. 数据库

```sql
ALTER TABLE users
  ADD COLUMN subscription_quota BIGINT NOT NULL DEFAULT 0
    COMMENT '订阅积分(VIP或每月免费,周期清零)',
  ADD COLUMN timed_quota_total  BIGINT NOT NULL DEFAULT 0
    COMMENT '定时积分总和(冗余,等于未过期账本之和)';

CREATE TABLE user_timed_quotas (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id     INT NOT NULL,
  amount      BIGINT NOT NULL  COMMENT '本笔发放额',
  remaining   BIGINT NOT NULL  COMMENT '本笔剩余',
  source      VARCHAR(32) NOT NULL
    COMMENT 'register/redeem/topup/invite/admin/refund/migration',
  source_ref  VARCHAR(64) NULL,
  expires_at  DATETIME NULL  COMMENT 'NULL=永久',
  created_at  DATETIME NOT NULL,
  INDEX idx_user_alive (user_id, remaining, expires_at)
);

-- 数据迁移函数(PR1 实现但不调用,延后到 PR2 同次部署里执行,详见 §10):
-- 把老 quota 全部转为永久定时积分(最保守,老用户零损失)
INSERT INTO user_timed_quotas (user_id, amount, remaining, source, expires_at, created_at)
  SELECT id, quota, quota, 'migration', NULL, NOW()
  FROM users WHERE quota > 0 AND timed_quota_total = 0;
UPDATE users u JOIN (...) t SET u.timed_quota_total = t.amount;
```

`last_free_quota_at` 字段保留,仍用于追踪每月免费 cron 的发放节奏。
`timed_quota_total` 是冗余字段,目的是让缓存层和余额查询不必每次 join 账本表。

### 关键原则: 数据迁移不能与读写切换错开

**Bug 场景**: 假设 PR1 启动时就跑迁移、PR2 才切读取语义到求和:

1. 老用户 A `quota = 1000`(已经扣得只剩 1000) → 部署 PR1
2. 迁移创建 `user_timed_quotas` 一行 `remaining=1000`,`timed_quota_total = 1000`
3. PR1→PR2 期间用户消费 800 → 老路径只扣 `quota` 列,剩 `quota=200`,但 `timed_quota_total` 仍是 1000,账本行 `remaining` 也仍是 1000
4. 部署 PR2,`GetUserQuota` 切为读 `subscription_quota + timed_quota_total`
5. 用户余额瞬间从 200 跳回 1000,**凭空多出 800**

根因: 数据迁移 + 双轨账本 + 实际扣费只走旧轨,导致账本与现实脱钩,PR1↔PR2 部署窗口越长偏差越大。

**强制约束**: 迁移函数 `migrateLegacyQuotaToTimedQuota` 必须在「所有写入路径已切到新 API」的同一次部署里调用。PR1 只建空表与新字段,迁移函数定义留下但不挂到启动链。

## 3. 扣费: 定时 → 订阅,定时按到期升序

```go
func DecreaseUserQuota(userId int, n int64) error {
  return DB.Transaction(func(tx *gorm.DB) error {
    var rows []UserTimedQuota
    if err := tx.Set("gorm:query_option", "FOR UPDATE").
      Where("user_id = ? AND remaining > 0 AND (expires_at IS NULL OR expires_at > NOW())", userId).
      Order("CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC").
      Find(&rows).Error; err != nil {
      return err
    }

    remain := n
    var deductedTimed int64
    for i := range rows {
      if remain == 0 { break }
      take := rows[i].Remaining
      if take > remain { take = remain }
      if err := tx.Model(&rows[i]).
        Update("remaining", gorm.Expr("remaining - ?", take)).Error; err != nil {
        return err
      }
      remain -= take
      deductedTimed += take
    }
    if deductedTimed > 0 {
      if err := tx.Model(&User{}).Where("id = ?", userId).
        Update("timed_quota_total",
          gorm.Expr("GREATEST(timed_quota_total - ?, 0)", deductedTimed)).Error; err != nil {
        return err
      }
    }
    if remain > 0 {
      res := tx.Model(&User{}).
        Where("id = ? AND subscription_quota >= ?", userId, remain).
        Update("subscription_quota", gorm.Expr("subscription_quota - ?", remain))
      if res.Error != nil { return res.Error }
      if res.RowsAffected == 0 { return errors.New("用户额度不足") }
    }
    return nil
  })
}
```

`CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END` 让永久积分排在所有有限期积分之后,统一兼容 MySQL 与 PostgreSQL 的 NULL 排序差异。

退款 (`token.go:292` 的负 quota 路径) 一律插一笔 `source='refund'` 的永久定时积分,不追溯原账本。

## 4. 加额接口

```go
SetUserSubscriptionQuota(userId, n)           // 覆盖式: VIP 续期 + 每月免费
IncreaseUserSubscriptionQuota(userId, n)      // 累加: VIP 首购/同周期升级叠加
AddUserTimedQuota(userId, amount, source, ref string, ttl *time.Duration) error
//   ttl == nil   表示永久
//   ttl != nil   表示 expires_at = now + *ttl
```

调用点对照表:

| 文件:行 | 改后调用 |
|---|---|
| `model/user.go:144` 注册:永久赠送部分 | `AddUserTimedQuota(uid, QuotaForNewUser, "register", "", nil)` |
| `model/user.go:144` 注册:首月免费 | `user.SubscriptionQuota = QuotaForMonthlyFree` (配合 LastFreeQuotaAt = now) |
| `model/user.go:161/165` 邀请奖励 | `AddUserTimedQuota(..., "invite", "", nil)` |
| `controller/user.go:890` 管理员充值 | `AddUserTimedQuota(..., "admin", remark, nil)` |
| `model/redemption.go:76` 兑换码 | `AddUserTimedQuota(..., "redeem", code, nil)` |
| `controller/payment.go` 在线充值(非订阅) | `AddUserTimedQuota(..., "topup", orderNo, nil)` |
| `controller/payment.go:createSubscriptionAfterPayment` 首购 | `IncreaseUserSubscriptionQuota(uid, quotaPerPeriod)` |
| `model/subscription.go:155` 续期 cron | `SetUserSubscriptionQuota(uid, totalQuota)` |
| `model/free_quota.go` 每月免费 cron | `SetUserSubscriptionQuota(uid, QuotaForMonthlyFree)` + 更新 last_free_quota_at |
| `model/token.go:292` 消费回滚 | `AddUserTimedQuota(..., "refund", "", nil)` |

`IssueMonthlyFreeQuotas` 内部 SQL 从 `quota = quota + ?` 改为 `subscription_quota = ?` (覆盖式,未用完不结转),更符合"每月免费"语义,也与 VIP 续期行为一致。

## 5. 互斥发放与 cron 顺序

- 首购 VIP 时: 用户当前的 `subscription_quota` 可能是上一轮每月免费的残余,新方案 `IncreaseUserSubscriptionQuota` 会叠加上去 (保留用户已有的免费额度)。
- VIP 到期下个 cron 周期: `AutoIssueMonthlyFreeQuotas` 仍只发给"无 active 订阅"的用户,自动接管。
- 0 点 cron 顺序: 当前 `main.go:119-120` 是 `AutoIssueMonthlyFreeQuotas` 在前、`AutoProcessSubscriptions` 在后,需要**调换**: 先续 VIP (处理到期/续期),再发免费 (此时刚到期的用户已无 active 订阅可正确接管),最后清过期定时积分。

## 6. 余额查询与缓存

`GetUserQuota(id)` = `subscription_quota + timed_quota_total`,单行读,无 join。
Redis `user_quota:%d` 仍只存总和,`CacheDecreaseUserQuota` 走总和无变化。

`GetSelf` 接口扩展返回:

```json
{
  "subscription_quota": 1000,
  "timed_quota_total":  1500,
  "timed_quota_breakdown": [
    { "remaining": 500,  "expires_at": "2026-06-26", "source": "redeem" },
    { "remaining": 1000, "expires_at": null, "source": "register" }
  ]
}
```

## 7. 过期清理

每天 0 点 cron 链最后跑一次 `AutoExpireTimedQuotas`:

```sql
-- 1. 累计每个用户即将清零的额度
UPDATE users u
JOIN (
  SELECT user_id, SUM(remaining) AS s
  FROM user_timed_quotas
  WHERE remaining > 0 AND expires_at IS NOT NULL AND expires_at <= NOW()
  GROUP BY user_id
) e ON u.id = e.user_id
SET u.timed_quota_total = GREATEST(u.timed_quota_total - e.s, 0);

-- 2. 把过期账本笔的 remaining 置 0
UPDATE user_timed_quotas SET remaining = 0
WHERE remaining > 0 AND expires_at IS NOT NULL AND expires_at <= NOW();
```

为什么需要主动清理而不是查询时过滤: `timed_quota_total` 是冗余字段,不主动清理会越积越大,前端显示余额虚高; 其次给账本表瘦身。

## 8. 改造文件清单

新增:
- `model/timed_quota.go` — 账本 model + AddUserTimedQuota / DeductTimedQuota / ExpireTimedQuotas
- `controller/timed_quota.go` (可选) — 用户查询自己账本明细
- `sql/migrations/2026-05-27-quota-split.sql`

修改:
- `model/user.go` — User struct 加两字段; DecreaseUserQuota 重写为事务版; 废弃 IncreaseUserQuota; Insert 改写
- `model/cache.go` `fetchAndUpdateUserQuota` — 改求和
- `model/free_quota.go` — UPDATE 改写订阅字段
- `model/redemption.go:76` — 改写账本插入
- `model/subscription.go:155` — `Update("subscription_quota", totalQuota)`
- `controller/user.go` AdminTopUp — 改写账本插入
- `controller/payment.go` `rechargeUserQuota` / `createSubscriptionAfterPayment` — 拆订阅与定时两种调用
- `model/token.go:292` 消费回滚 — 走 AddUserTimedQuota
- `main.go:113-120` 0 点 cron 调整顺序,加 `AutoExpireTimedQuotas`
- `controller/user.go:381` `GetSelf` 返回扩展
- 前端 UsersTable / Profile / 充值页 — 余额拆分展示

## 9. 风险点

1. 每月免费语义变化: 从"加到 quota"改为"覆盖 subscription_quota",未用完不结转。需要产品确认 — 但既然定义为订阅积分,就应当如此。
2. 续期清零 bug 修复: 用户在 VIP 续期当天,定时积分 (兑换/充值/邀请等) 不再被抹掉。release notes 必须写。
3. 首购叠加 vs 覆盖: 保留现有"首购累加上一轮残余"行为; 如产品想改为"首购也覆盖每月免费残余",把 `createSubscriptionAfterPayment` 也改成 `SetUserSubscriptionQuota` 即可,一行差异。
4. NULL 排序走 CASE 表达式,需要 `EXPLAIN` 验证两种 DB 都能命中 `idx_user_alive`; 不行的话把永久积分写哨兵 `9999-12-31` 简化。
5. 事务性能: 高并发消费同用户会因 `FOR UPDATE` 串行化,Redis 预扣作为乐观闸门挡在前面,落账串行可控。

## 10. 推荐落地顺序

**PR1 (已完成,基础设施 only,不改变运行时行为)**
- 建表 `user_timed_quotas`,`users` 加 `subscription_quota` / `timed_quota_total` 两列
- 新 API: `AddUserTimedQuota` / `GetUserTimedQuotaBreakdown` / `ExpireTimedQuotas` / `SetUserSubscriptionQuota` / `IncreaseUserSubscriptionQuota`
- `migrateLegacyQuotaToTimedQuota` 函数定义存在,但**不挂启动链**(避免脱钩 bug,详见 §2)
- `AutoExpireTimedQuotas` cron + 0 点链顺序调整(续订阅 → 发免费 → 清过期)
- `IncreaseUserQuota` / `DecreaseUserQuota` / `GetUserQuota` 完全不动,所有现有写入读取路径无变化
- 单测覆盖 4 个新 API

**PR2 (已完成,本次部署原子切换)**
- 已切完 §4 调用点对照表里全部写入路径:
  - `model/user.go` Insert: 注册赠送走 `AddUserTimedQuota(register, 永久)`,首月免费走 `subscription_quota` 字段直写
  - `model/user.go` 邀请奖励 → `AddUserTimedQuota(invite, 永久)`
  - `controller/user.go` AdminTopUp → `AddUserTimedQuota(admin, 永久)`,备注作为 source_ref
  - `model/redemption.go` 兑换码 → 事务内插行 + 同步 timed_quota_total / quota 镜像
  - `controller/payment.go` 在线充值 `rechargeUserQuota` 已删除(全部走订阅路径)
  - `controller/payment.go` `createSubscriptionAfterPayment` 首购 → `IncreaseUserSubscriptionQuota`(累加,保留每月免费残余)
  - `model/subscription.go:155` 续期 cron → `SetUserSubscriptionQuota`(覆盖式)
  - `model/free_quota.go` 每月免费 cron SQL 改为 `subscription_quota = ? AND quota = ? + COALESCE(timed_quota_total, 0)` 覆盖式
  - `model/token.go:292` 消费回滚 → `AddUserTimedQuota(refund, 永久)`
- `DecreaseUserQuota` 重写为事务版,`SELECT ... FOR UPDATE` 后按 `(CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, id ASC)` 顺序消费定时积分,溢出走订阅。事务内同步维护 quota 镜像
- `GetUserQuota` 切为 `SELECT subscription_quota + timed_quota_total`(单行,无 join)
- `IncreaseUserQuota` 收敛到 `AddUserTimedQuota(admin, 永久)`,兼容外部插件/脚本
- `model/main.go` `migrateDB()` 末尾**已调用** `migrateLegacyQuotaToTimedQuota`,与所有写入路径切换在同一次部署原子完成,避免账本/现实脱钩
- `AddUserTimedQuota` / `ExpireTimedQuotas` 内部事务同步维护 `quota` 镜像列,保证旧排序/仍然 `Update("quota")` 的兜底路径仍然正确

**PR2 部署前置检查清单(已完成)**:
- [x] §4 表里 9 个写入入口全部切完;`grep "Update(\"quota\""` 仅剩 organization 与 user.Quota 镜像写
- [x] `DecreaseUserQuota` 已重写为事务版本
- [x] `GetUserQuota` 已切求和读取
- [x] 迁移函数 `migrateLegacyQuotaToTimedQuota` 已挂回 `migrateDB()` 末尾
- [x] 关键测试新增(扣费顺序 / 求和 / 兼容旧 IncreaseUserQuota / 透支兜底);`go test ./model/ -run 'TestAddUserTimedQuota|TestSetUserSubscriptionQuota|TestIncreaseUserSubscriptionQuota|TestExpireTimedQuotas|TestGetUserQuota_SumOfTwoFields|TestIncreaseUserQuota_LegacyAdditiveLandsInTimedLedger|TestDecreaseUserQuota_*|TestFreeQuota_*|TestSubscriptionRenewal_*'` 全绿
- [ ] **部署前**:备份生产 DB 快照(回滚预案)

**PR3 (已完成,前端展示)**
- `controller/user.go` `GetSelf` 已返回:
  - `data.subscription_quota` / `data.timed_quota_total`(随 user 序列化)
  - `timed_quota_breakdown`:未过期账本明细数组,按到期升序(永久排最后)
- `web/air` 前端拆分展示:
  - `components/PersonalSetting.js` 个人页 footer 增"订阅积分" / "定时积分"两条
  - `components/UsersTable.js` 管理员列表"剩余额度"Tooltip 展开拆分
  - `pages/User/EditUser.js` 管理员编辑用户页"剩余额度"下方展示订阅/定时拆分
- 仅改 air 主题(default 主题不在生产部署,按用户要求跳过)

**PR4 (可选,清理)**
- 确认 PR2 上线一段稳定期后,删除 `users.quota` 物理列与 `IncreaseUserQuota` 兼容函数

## 11. 历史用户影响评估

- **客户端不更新版本**: 接口契约 (`GetSelf` / token 消费 API) 在 PR1/PR2 都不破坏旧字段,客户端无感
- **PR1 部署**: 仅建表 + 加列 + 注册 4 个新 API,生产用户读写走老路径完全不变;迁移不跑,新表始终是空的
- **PR2 部署**: 一次性把所有发放/扣费切到新 API,同次部署内迁移函数把历史 `quota` 搬到 `user_timed_quotas`;切换原子完成,余额不会出现脱钩或回弹
- **回滚预案**:
  - PR1 回滚: drop 两列 + drop `user_timed_quotas` 表,老 `quota` 列从未停止维护,数据零丢失
  - PR2 回滚: 风险高,需要先把 `subscription_quota + timed_quota_total` 的差值回写到 `quota` 列;建议 PR2 上线前生产 DB 快照,真出问题宁可恢复快照而非滚动回退

### 11.1 PR2 review 发现并修复的 5 条边界 bug

1. **batch update 负值路径漂移(已修)**
   生产配置 `BATCH_UPDATE_ENABLED=true` 时,`DecreaseUserQuota` 把 `-quota` 入队,
   原 `increaseUserQuota(负值)` 只动 `timed_quota_total + quota` 镜像,不读账本行也不扣订阅,
   余额会随机漂移。修复:`utils.go` 拆正负方向,负值改走 `decreaseUserQuota` 事务版;
   `increaseUserQuota` 严格要求 `quota >= 0`。
   测试:`TestBatchUpdate_NegativeUserQuota_DeductsLedger` / `TestBatchUpdate_PositiveUserQuota_LandsInTimedLedger`
2. **续期覆盖式语义需明示(产品确认)**
   `SetUserSubscriptionQuota` 是覆盖式;若用户当周期 VIP 还有未消费余额,续期当天会被覆盖为新一期额度。
   产品语义应该如此(订阅积分=按月清零),但需要在 release notes 写明,避免 VIP 用户投诉"积分变少"。
3. **迁移多节点不一致窗口(已修)**
   原逐用户事务版本下,从节点会读到"已插账本但 timed_quota_total=0"的瞬时态,
   `GetUserQuota` 求和 = 0,该用户瞬间余额变 0。修复:MySQL/PostgreSQL 走两条全表 SQL
   (`INSERT...SELECT` + `UPDATE`)单事务原子提交;SQLite 保留逐用户路径(本地开发用)。
4. **Redis 缓存 user_quota 老值残留(已修)**
   PR2 重启后,Redis 已写入的 `user_quota:%d` 是老 `quota` 列计算的;
   迁移完成后老缓存与新求和读理论一致(因迁移就是把 quota 整搬过来),
   但中间窗口/手工迁移失败/部署顺序异常都会让两者偏离。
   修复:`model.FlushUserQuotaCache()`(SCAN + DEL) 在 `main.go` Redis 初始化后调用一次。
5. **首购 VIP 累加每月免费残余的会计含义(无须改动)**
   `IncreaseUserSubscriptionQuota` 累加,会保留同周期的每月免费残余;若产品想改"首购也覆盖每月免费",
   把 `createSubscriptionAfterPayment` 里的 `IncreaseUserSubscriptionQuota` 改 `SetUserSubscriptionQuota` 即可,
   一行差异。当前保持累加(与 §5/§13 推荐一致)。

## 12. 待确认

- 兑换码、管理员充值、在线充值默认是否全部永久,还是要加可配置 TTL?
- 首购 VIP 时是覆盖还是叠加每月免费残余? (推荐保持现状叠加)
