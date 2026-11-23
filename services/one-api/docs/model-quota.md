# Model quota accounting

English | [中文](model-quota.zh.md)

Model requests through `/v1/chat/completions` use the authenticated token's account and the platform's model pricing. Desktop planning-lecture analysis uses the same relay. A deployment with credits disabled records usage without deducting quota.

Token debit and refund updates use atomic SQL expressions with a zero lower bound. SQLite uses `MAX(value, 0)`; MySQL and PostgreSQL use `GREATEST(value, 0)`. Queued batch debits use the same expression. An account debit or refund failure returns before adjusting the token.

Verify a settlement by comparing account quota, token remaining/used quota, and the corresponding consumption log before and after one completed request. A consumption log alone does not prove every balance update succeeded. Historical mismatches require a request- and token-specific audit; do not replay a charge against an account that already paid it.

Focused checks: `go test ./model ./relay/controller -run 'TestSQLiteTokenQuota|TestSQLiteLegacyBilling|TestCreditBillingActualBalanceReceiptAndFailureRefund' -count=1`.
