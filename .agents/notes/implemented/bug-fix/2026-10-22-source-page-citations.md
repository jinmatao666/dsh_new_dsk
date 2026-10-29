# Agent Note: Web citations use retrieved source pages

Status: implemented

English | [中文](2026-10-22-source-page-citations.zh.md)

## Problem

Search-model summaries can contain invented claims and links even when structured retrieval metadata includes legitimate URLs. Passing that prose to the conversation model risks repeating unsupported news with unrelated citations. Generic citation labels do not identify the page being cited.

## Decision

The OneAPI search provider forwards structured retrieval URLs but not generated summary prose. It accepts retrieval metadata without requiring a generated answer; absent sources produce a verification warning instead of an unsourced summary. The authenticated search request asks for specific supporting pages with their real titles as clickable labels.

A product-owned system-prompt section requires reading candidate pages through available fetch or browser tools, checking claim support and dates, and citing the actual returned URL with the retrieved or inspected page's real title. Missing titles use the clickable original URL rather than an invented title or a generic label. Failed reads or unsupported claims must remain unverified or be omitted. This instruction belongs to the Host prompt independently of untrusted web content, and its registration follows plugin disposal. Standard, PTC and Cordis presets already expose web_fetch; this change does not alter their tool configuration.

For multi-item news requests, each item requires a distinct supporting article URL; one roundup page counts as one source. The provider reports the number of distinct retrieval URLs and warns when only one was found. The search request asks for independent pages from different publishers. If further searches still yield too few verified pages, the answer reports fewer items rather than splitting a roundup into invented independent citations.

## Alternatives considered

**Rename labels only.** A uniform label does not stop invented links and unsupported claims from entering model context.

**Parse links out of generated prose.** A syntactically valid link is not retrieval evidence. Structured metadata avoids depending on every Markdown or HTML link spelling.

Search requests retain the original query under separate retrieval instructions. Structured snippets and valid ISO publication dates are preserved when supplied; generated answer prose is excluded. Results direct the agent to read relevant articles before targeted supplementary searches. Publisher diversity is a quality goal, not a three-website answer prerequisite. Consecutive supplementary rounds without new effective sources must stop and explain the failing stage. A single positive site term is checked against returned hostnames; a completely mismatched response raises WEB_PROVIDER_SCOPE_MISMATCH rather than claiming the site has no news. Compound OR queries are left intact. These instructions do not mechanically validate the final answer or prove live search completeness.

## Consequences

Source inspection can increase latency and tokens. Filtering generated summaries deterministically removes that upstream path for fabricated prose and URLs; it does not prove retrieval URLs are reachable or that the final conversation model follows the citation instructions. No live-news truthfulness guarantee is claimed. Focused tests cover generated fake links with and without structured sources, missing summary text, URL filtering and a Loader-mounted prompt/tool presentation snapshot.
