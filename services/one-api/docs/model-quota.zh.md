# 模型额度记账

[English](model-quota.md) | 中文

通过 `/v1/chat/completions` 的模型请求使用鉴权令牌所属账号，并沿用平台模型定价。桌面资规讲坛分析走同一条转发链路。部署关闭积分机制时记录用量，不扣额度。

令牌扣减和退款使用下限为零的原子 SQL 表达式。SQLite 使用 `MAX(value, 0)`；MySQL 和 PostgreSQL 使用 `GREATEST(value, 0)`。批量队列中的扣减复用同一表达式。账号扣减或退款失败时，返回错误后不再调整令牌。

核验结算时，应比较一次完成请求前后的账号额度、令牌剩余及已用额度、对应消费日志。只有消费日志不能证明所有余额更新成功。历史差异需要按请求和具体令牌审计；账号已支付的消费不得重新扣款。

定向检查：`go test ./model ./relay/controller -run 'TestSQLiteTokenQuota|TestSQLiteLegacyBilling|TestCreditBillingActualBalanceReceiptAndFailureRefund' -count=1`。
