# Agent Note: Operations model credit settlement

Status: implemented

English | [中文](2026-11-03-operations-credit-pricing-preview.zh.md)

## Problem

Administrators need independent input and output multipliers, separately priced cache usage, and consumption details that agree with deducted balances. The old completion multiplier is relative to input, and cached tokens previously only contributed observations.

## Decision

The operations edition saves `creditPricingBase` in `SystemDeploymentSettings`, defaulting to one credit per thousand tokens at 1×. The model editor saves independent input, output, cache-read, and cache-write multipliers in `ModelCreditPricing`; read-only prices equal base times multiplier. Missing cache rates use the input rate. Existing preview options do not silently enable charging: the administrator saves the model to the live option.

The optional `display` field in each model price entry controls the desktop reference multiplier. Omission computes the arithmetic mean of input and output multipliers; an explicit value, including zero, remains fixed when rates change. The model editor supports restoring the automatic default. Authenticated model metadata carries `display_multiplier` through the managed provider and shared model directory to the picker, where it appears beside the model name with a reference-only hint. Model ids and settlement rates remain independent of this presentation field.

Text relay requests freeze a price snapshot before contacting the upstream. Ordinary input excludes cache-read and cache-write tokens; all four buckets multiply their respective rates, the common base, and the group multiplier. Decimal rational arithmetic rounds the sum up once to an internal quota unit. Government edition and models without live prices retain legacy settlement. This change covers token-based text relay, not separately billed image/audio services or external usage reporting.

Personal reservations and settlement update the user ledger and token in one database transaction, reject insufficient funds, and return refunds to their original ledger rows without extending expiration. A conservative reservation assumes no cache discount. Upstream failure refunds the reservation. If actual usage exceeds the reservation and the additional debit fails, consumption details show the retained reservation and a reconciliation status rather than claiming full settlement. This is request-local settlement, not a durable reservation/recovery job for server crashes.

Consume logs retain the price snapshot, disjoint token buckets, session, and actual debit even when general consumption logging is disabled. The administrator-only `积分明细` tab in model logs supports server-side filtering and pagination, and shows the frozen calculation. Older logs without snapshots retain their original internal units instead of inventing historical prices. Standard OpenAI usage details and the DeepSeek cache-hit fallback feed the cache buckets; Anthropic input adds its separately reported cache buckets before normalization. Missing cache usage receives no discount.

The operations settings also persist `creditRewards`: independent registration and login switches, integer amounts from 1 to 1,000,000 credits, and an integer login `intervalDays` from 1 to 3,650. Missing rules load disabled with defaults of 2,000 registration credits and 100 login credits every day. The intended login rule grants on the first login after the interval, measured from the previous grant date, with no catch-up for missed days. The settings introduce no validity or campaign dates. This stage configures policy only; automatic issuance is not connected. Invalid explicit rules are rejected on both client and server. Successful edits put before/after reward rules ahead of the generic settings snapshot in the existing administrator audit log so long configurations cannot hide them through truncation. The existing audit writer remains asynchronous and is not transactionally coupled to the option save. Database option failures now propagate without changing the active option map or returning a successful save.

## Alternatives considered

**Change legacy multipliers globally.** Rejected because independent output prices cannot be represented when input is zero, and unrelated services still consume the legacy maps.

**Charge cached tokens again as ordinary input.** Rejected because this double charges cache hits. The buckets are disjoint and invalid totals trigger a refund path.

**Round each request to a whole credit.** Rejected because short requests would be disproportionately expensive. Only the internal quota total rounds up.

## Consequences

Saved live prices apply to subsequent requests; historical snapshots remain unchanged. Local SQLite integration exercises actual relay HTTP success and failure, balance/log agreement, insufficient funds, and refunds. Focused tests cover cache arithmetic, snapshot stability, Anthropic stream/JSON normalization, and the details endpoint/page. Browser screenshots use example API responses; live upstream billing has not been verified with production credentials. Packages, wallet issuance, and pricing profitability remain separate work.
