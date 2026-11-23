# Planning lecture credits

[中文](forum-analysis.zh.md)

System Settings → Feature Settings → Planning Lecture → Address Configuration includes Credit Configuration for popup questions (`qa`) and report generation (`report`). Both default to one point; zero is free. Save Credit Configuration applies immediately and keeps the address draft open; the address requires Confirm and then Save Settings. The two configured `planning_lecture/default` charge points use the expert billing task implementation. Their names are fixed and their revisions prevent stale updates.

The authenticated desktop Host uses these endpoints under `/api/portal/planning-lecture`:

| Endpoint | Purpose |
|---|---|
| `GET /admin/credits` | Administrator reads both credit amounts and revisions. |
| `PUT /admin/credits` | Administrator atomically saves `qa` and `report`, each containing decimal-string `credits` and integer `version`. |
| `POST /analysis/quote` | Quote `item.id`, `item.type` and `question`; returns `credits`, `version`, `cached`. |
| `POST /analysis/begin` | Same identity plus accepted `version`, fresh `session_id` and selected `managed_model`; reserves the configured price or returns the original answer. |
| `POST /analysis/:id/result` | Attempt owner supplies its `lease`, `status` and, on success, `text`, `provider`, `model`; saves the answer and settles in one transaction. |

The API derives the payer from authentication. The question key distinguishes source type, source ID and action, and normalizes question whitespace. Account ownership is part of the database uniqueness constraint. History, model and price changes do not invalidate a successful answer. A pending attempt returns `ANALYSIS_PENDING`; failure/cancellation refunds and permits another attempt. Abandoned reservations expire after thirty minutes through the existing unified billing worker.

The platform relay accepts one text-only model call for the exact authenticated account, reserved session and selected model. A persisted atomic claim prevents another HTTP call from reusing the exemption; channel retries within the original request reuse its claim. Model usage remains in logs at zero additional credit cost, while the business receipt records the configured charge. Other sessions retain normal model pricing. Report generation returns text in the forum drawer.

Deploy the OneAPI backend, desktop portal/auth modules and `ais-rpforum` frontend together. Backend startup migrates `forum_analyses`; first configuration or analysis use initializes the two default rules. The forum server requires no model API key or new billing secret. Existing desktop identity redemption remains unchanged.

Question submission requires no fee-confirmation step. The backend derives the action from report-generation wording, ignoring caller-supplied action labels. Model text is streamed from `/api/desktop-forum/stream` as NDJSON; the final result is sent only after persistence and settlement.
