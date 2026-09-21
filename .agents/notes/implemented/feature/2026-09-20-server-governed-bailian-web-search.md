# Agent Note: Server-governed Bailian Web search

Status: implemented

English | [中文](2026-09-20-server-governed-bailian-web-search.zh.md)

## Problem

Desktop Web search depended on a separate local DeepSeek credential even though authenticated users already reached conversation models through OneAPI. That made search work on a developer machine but fail on another installation without the local environment variable, and it gave administrators no single place to select the paid model and channel used for retrieval.

## Decision

The OneAPI Basic Settings page stores a default search model together with its exact channel id. The selector contains only enabled model sources whose model family supports Bailian Web search. The relay repeats those checks before every marked request and pins distribution to that channel. The channel may use the dedicated Bailian type or an OpenAI-compatible type because Bailian workspace endpoints expose the same compatible request fields.

The desktop composition selects the `oneapi-bailian` search provider. It reads the public model name from `/api/status`, authenticates `/v1/chat/completions` with the existing desktop user token, and marks only that auxiliary request with `X-Dsh-Web-Search: 1`. OneAPI injects Bailian's `enable_search` and forced-search options only when this marker passed authentication and server-side route validation. Ordinary conversation requests never receive those fields and continue through normal model distribution.

The auxiliary request is recorded as `web/oneapi-search-request` without credentials before dispatch. The event is registered in the generated persistence catalog and marked ignorable because older readers can reconstruct the conversation without this observational record. The response text is returned as provider content; this route does not invent source metadata that Bailian's OpenAI-compatible response did not provide.

## Alternatives considered

**Give every desktop installation a search API key.** Rejected because it repeats secret distribution and recreates the machine-specific failure this route removes.

**Let the selected conversation model decide whether to search.** Rejected because most configured models have no native Internet access and model selection would not identify the intended Bailian channel.

**Add search parameters to every Bailian chat request.** Rejected because it would change ordinary conversations, add cost and latency, and make search behavior depend on model routing rather than an explicit capability call.

## Consequences

Administrators control search cost and availability centrally, and desktop users need only their existing login token. Search fails explicitly when the configured model, channel, or binding is unavailable. The model-family allowlist must be updated when Bailian adds or removes supported families. Selecting a compatible channel that does not accept Bailian search fields produces an upstream request failure instead of changing ordinary conversation behavior. The existing direct DeepSeek provider remains available to non-desktop compositions.
