# 积分拆分改造审查与检测清单

日期: 2026-05-28
范围: 当前工作区未暂存修改。暂存区为空,`git diff --cached` 无内容。

## 结论摘要

当前改造方向是把 `users.quota` 拆为:

- `users.subscription_quota`: VIP / 每月免费等周期覆盖积分
- `users.timed_quota_total`: 定时积分冗余总额
- `user_timed_quotas`: 定时积分账本明细
- `users.quota`: 兼容镜像列

主要逻辑路径已经覆盖注册、邀请、兑换、管理员充值、订阅首购/续期、每月免费、消费扣费和过期清理。但仍存在几个需要在上线前处理的问题,其中历史用户影响最大。

## 本次修复记录

- 已修复: 新空库 root 用户创建时改为通过 `AddUserTimedQuota(..., "initial_root")` 发放初始余额,避免真实余额为 0。
- 已修复: 管理员编辑用户资料时不再通过通用 `User.Update` 写 `quota/subscription_quota/timed_quota_total`;如果请求显式携带 `quota`,改走 `SetUserTotalQuota` 做账本化总余额校准。
- 已修复: `AddUserTimedQuota` 在事务内校验用户存在并检查 `RowsAffected`,避免不存在用户产生孤儿账本。
- 已修复: 扣定时积分改用 GORM v2 `clause.Locking{Strength:"UPDATE"}` 并在扣单行时增加 `remaining >= take` 条件。
- 已修复: batch 用户加额和扣费拆成两个类型,不再对正负方向净额合并。
- 已调整: 历史迁移对 active 订阅用户先按 active 订阅 `quota_per_period` 合计上限切出 `subscription_quota`,仅把超出部分迁为永久定时积分,降低下次续期翻倍风险。

## P0: 历史用户存量余额会被全部迁移为永久定时积分

### 位置

- `model/main.go:migrateLegacyQuotaToTimedQuota`
- `model/subscription.go:ProcessUserSubscriptionRenewal`

### 现象

迁移逻辑把所有 `users.quota > 0 AND timed_quota_total = 0` 的余额插入 `user_timed_quotas` 永久账本,同时 `subscription_quota` 保持 0。

这能保证老用户余额不减少,但会改变 VIP / 每月免费残余额的生命周期:

1. 老 VIP 用户当前 `quota = 5000`,本质可能是当前订阅周期余额。
2. 迁移后变为 `timed_quota_total = 5000`,永久有效。
3. 下次 VIP 续期 `SetUserSubscriptionQuota(userId, 5000)`。
4. 用户总余额变为 `subscription_quota 5000 + timed_quota_total 5000 = 10000`。
5. 如果订阅到期,这笔迁移来的 5000 也不会清零。

### 影响

历史 VIP 用户、历史每月免费用户的周期性余额会被永久化。结果是余额不丢,但会多保留一部分原本应随周期覆盖或过期的额度。

### 检测 SQL

```sql
-- 有 active 订阅且会被迁移为永久定时积分的用户
SELECT u.id, u.username, u.quota, COUNT(s.id) AS active_sub_count
FROM users u
JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
WHERE u.quota > 0 AND COALESCE(u.timed_quota_total, 0) = 0
GROUP BY u.id, u.username, u.quota;
```

### 建议

上线前需要产品确认迁移策略:

- 保守方案: 接受全部历史余额永久化,但 release notes 明确说明老余额被保护为永久积分。
- 更严格方案: 对 active VIP 用户把一部分余额迁入 `subscription_quota`,而不是全部迁入永久账本。由于历史 `quota` 没有来源明细,只能按规则估算,例如 `subscription_quota = LEAST(quota, 当前最高/合计 active subscription 的 quota_per_period)`。

## P0: 新空库 root 用户实际余额为 0

### 位置

- `model/main.go:37-46`
- `model/user.go:GetUserQuota`

### 现象

`CreateRootAccountIfNeed` 在迁移之后执行。新空库创建 root 时只设置 `Quota: 500000000000000`,没有设置 `TimedQuotaTotal` 或 `SubscriptionQuota`。但新读取逻辑 `GetUserQuota` 只读 `subscription_quota + timed_quota_total`,所以 root 的实际可用余额为 0。

### 检测步骤

1. 使用空库启动。
2. 查询:

```sql
SELECT id, username, quota, subscription_quota, timed_quota_total,
       subscription_quota + timed_quota_total AS real_quota
FROM users
WHERE username = 'root';
```

预期当前代码会出现 `quota > 0` 但 `real_quota = 0`。

### 建议

创建 root 时同步设置:

```go
Quota: 500000000000000,
TimedQuotaTotal: 500000000000000,
```

或者在 `DB.Create(&rootUser)` 后调用 `AddUserTimedQuota(rootUser.Id, amount, TimedQuotaSourceAdmin, "initial_root", nil)`。

## P0: 管理员编辑用户余额只改镜像列,不改真实余额

### 位置

- `controller/user.go:513`
- `model/user.go:197-210`
- `model/user.go:393-403`

### 现象

管理员编辑用户时仍走 `updatedUser.Update(updatePassword)`,内部是 `DB.Model(user).Updates(user)`。如果前端提交 `quota`,它只会写 `users.quota` 镜像列;真实读取走 `subscription_quota + timed_quota_total`,所以用户实际余额不会变。

反过来,如果请求体携带了 `subscription_quota` 或 `timed_quota_total`,`Updates(user)` 可能直接写入这些字段,绕过账本明细,造成 `timed_quota_total` 与 `user_timed_quotas.remaining` 不一致。

### 检测步骤

1. 找一个用户:

```sql
SELECT id, quota, subscription_quota, timed_quota_total
FROM users
WHERE id = ?;
```

2. 通过管理员编辑接口把 `quota` 改成新值。
3. 再查:

```sql
SELECT id, quota, subscription_quota, timed_quota_total,
       subscription_quota + timed_quota_total AS real_quota
FROM users
WHERE id = ?;
```

如果 `quota != real_quota`,说明 UI 展示和实际扣费会分裂。

### 建议

管理员编辑余额不要走通用 `User.Update`。需要单独定义余额调整语义:

- 充值/加额: `AddUserTimedQuota(..., source=admin, ...)`
- 直接校准总余额: 新增专用函数,在事务内重建/调整 admin correction 账本,同步 `timed_quota_total` 和 `quota`
- 普通资料更新: 明确 `Select` 白名单,排除 `quota/subscription_quota/timed_quota_total`

## P1: 扣定时积分的行锁写法可能在 GORM v2 不生效

### 位置

- `model/user.go:520-523`
- `go.mod`: `gorm.io/gorm v1.25.10`

### 现象

代码使用:

```go
tx.Set("gorm:query_option", "FOR UPDATE")
```

这是 GORM v1 常见写法。GORM v2 推荐使用 `Clauses(clause.Locking{Strength: "UPDATE"})`。如果当前写法不生成 `FOR UPDATE`,同一用户并发扣费可能同时读到同一笔 `remaining`,然后都执行 `remaining = remaining - take`。账本行可能被扣成负数,`timed_quota_total` 和明细也会漂移。

### 检测步骤

用 DryRun 或 SQL 日志确认查询是否带 `FOR UPDATE`。也可以写并发测试:

1. 用户有一笔 `remaining=100` 的定时积分。
2. 并发两次 `DecreaseUserQuota(userId, 100)`。
3. 检查:

```sql
SELECT remaining FROM user_timed_quotas WHERE user_id = ?;
SELECT timed_quota_total, quota FROM users WHERE id = ?;
```

如果 `remaining < 0` 或汇总不一致,说明锁失效。

### 建议

改用 GORM v2 锁:

```go
Clauses(clause.Locking{Strength: "UPDATE"})
```

同时扣单行时增加条件保护:

```sql
WHERE id = ? AND remaining >= ?
```

并检查 `RowsAffected`。

## P1: AddUserTimedQuota 不检查用户是否存在,可能产生孤儿账本

### 位置

- `model/timed_quota.go:61-76`
- `controller/user.go:901-910`

### 现象

`AddUserTimedQuota` 先插入账本,再 `UPDATE users WHERE id = ?`。如果 `userId` 不存在,在没有外键约束时会留下孤儿账本行,而 `UPDATE` 的 `RowsAffected=0` 不会被当作错误。管理员充值接口会返回成功并记录日志,但用户余额没有变化。

### 检测步骤

调用管理员充值接口,传一个不存在的 `user_id`,然后查询:

```sql
SELECT * FROM user_timed_quotas WHERE user_id = ?;
SELECT * FROM users WHERE id = ?;
```

### 建议

在事务里先锁定/确认用户存在,或者检查 `UPDATE users` 的 `RowsAffected == 1`。如果数据库允许,给 `user_timed_quotas.user_id` 加外键。

## P1: BatchUpdate 会把加额和扣费按用户净额合并,账本语义丢失

### 位置

- `model/utils.go:38-45`
- `model/utils.go:58-68`
- `model/user.go:436-438`
- `model/user.go:502-504`

### 现象

`BatchUpdateTypeUserQuota` 对同一用户只保存一个净增量。旧单字段余额时代这通常只影响最终数值;现在积分有来源和生命周期,净额合并会丢语义。

示例:

1. 同一 batch 窗口内,用户消费 `-100`。
2. 兼容路径 `IncreaseUserQuota(+100)` 发放一笔永久定时积分。
3. store 内净额为 0。
4. flush 时什么都不做。

结果: 消费没有按定时/订阅顺序扣账,新增永久积分也没有账本行。

### 检测步骤

开启 `BatchUpdateEnabled`,构造同一用户同一窗口内一笔 `DecreaseUserQuota` 和一笔 `IncreaseUserQuota`,flush 后对比:

```sql
SELECT quota, subscription_quota, timed_quota_total FROM users WHERE id = ?;
SELECT source, amount, remaining FROM user_timed_quotas WHERE user_id = ? ORDER BY id;
```

### 建议

把用户扣费和发放拆成不同 batch 类型,至少不能对正负方向做净额合并。更稳妥是账本型操作不要 batch 合并,只 batch 纯统计字段。

## P1: 注册赠送失败会被吞掉,但日志仍显示已赠送

### 位置

- `model/user.go:154-176`

### 现象

新用户先创建,再调用 `AddUserTimedQuota` 发注册赠送和邀请赠送。注册赠送失败只写系统错误,仍继续返回注册成功并写“新用户注册赠送”日志;邀请赠送错误直接忽略。

### 影响

用户看到日志或运营统计显示已赠送,但真实账本没有余额。

### 建议

注册用户、注册赠送、邀请赠送至少应在一个事务内处理关键路径。若业务允许赠送失败不阻断注册,则日志必须只在加额成功后写。

## P2: 退款会永久化原本可能快过期的积分

### 位置

- `model/token.go:292`

### 现象

消费回滚不追溯原账本,统一新增 `source=refund` 的永久定时积分。这会把原本来自订阅或快过期定时积分的预扣差额变成永久积分。

### 建议

如果产品接受“退款永久化”,保留即可,但应写入规则说明。如果不接受,需要在预扣时记录扣减明细,回滚时按原账本恢复。

## P2: 多主/重复迁移仍可能重复插入 migration 行

### 位置

- `model/main.go:279-299`

### 现象

迁移在单事务内执行 `INSERT ... SELECT WHERE timed_quota_total = 0` 和 `UPDATE users SET timed_quota_total = quota`。如果两个主节点同时跑迁移,两个事务都可能在对方提交前看到 `timed_quota_total = 0`,从而重复插入 migration 账本行。

### 建议

生产上保证只有一个迁移执行者。代码层可增加迁移锁、唯一键 `(user_id, source, source_ref)` 或先锁定 users 待迁移行。

## 上线前一致性检测 SQL

### 1. 镜像余额是否等于真实余额

```sql
SELECT id, username, quota, subscription_quota, timed_quota_total,
       subscription_quota + timed_quota_total AS expected
FROM users
WHERE quota <> subscription_quota + timed_quota_total;
```

### 2. 定时积分冗余总额是否等于账本 remaining 之和

```sql
SELECT u.id, u.username, u.timed_quota_total,
       COALESCE(SUM(CASE
         WHEN tq.remaining > 0 AND (tq.expires_at IS NULL OR tq.expires_at > CURRENT_TIMESTAMP)
         THEN tq.remaining ELSE 0 END), 0) AS ledger_total
FROM users u
LEFT JOIN user_timed_quotas tq ON tq.user_id = u.id
GROUP BY u.id, u.username, u.timed_quota_total
HAVING u.timed_quota_total <> ledger_total;
```

### 3. 负数/异常账本

```sql
SELECT * FROM user_timed_quotas
WHERE amount <= 0 OR remaining < 0 OR remaining > amount;
```

### 4. 孤儿账本

```sql
SELECT tq.*
FROM user_timed_quotas tq
LEFT JOIN users u ON u.id = tq.user_id
WHERE u.id IS NULL;
```

### 5. 历史 active VIP 迁移影响面

```sql
SELECT u.id, u.username, u.quota, u.subscription_quota, u.timed_quota_total,
       s.package_id, s.package_level, s.quota_per_period, s.current_period_end
FROM users u
JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
WHERE u.timed_quota_total > 0
ORDER BY u.timed_quota_total DESC;
```

## 建议修复优先级

1. 先修 root 初始化和管理员编辑余额,这两个会直接导致“显示有余额但实际不可用”或“管理员改了但不生效”。
2. 明确历史用户迁移策略,尤其是 active VIP 用户的老余额是否永久保留。
3. 修扣费锁和 `RowsAffected` 检查,避免高并发账本漂移。
4. 决定 batch user quota 是否继续允许;如果允许,拆正负方向。
5. 补并发扣费、管理员改余额、root 初始化、active VIP 迁移的单测/集成测试。
