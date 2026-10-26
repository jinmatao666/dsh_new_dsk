# Agent Note: Bootstrap expert tickets in the trusted document

Status: implemented

English | [中文](2026-10-26-expert-ticket-document-bootstrap.zh.md)

## Problem

Affected Mac requests reach Nginx with `%23ticket=` in the HTTP path and receive 401 before the workbench loads. Launch issuance succeeds. Native logs confirm creation and navigation but do not identify which native conversion produces the encoded path.

## Decision

Native navigation uses the validated entry URL without its fragment. A document-start script restores the fragment through history replacement before site scripts run, only for the top-level document with the exact registered origin, path and query. A session-storage marker derived from the launch URL hash prevents reusing the ticket after reload. The server still redeems a short-lived, single-use ticket; provider credentials never enter the bootstrap.

## Alternatives considered

Accepting encoded ticket paths at the gateway retains credential-bearing HTTP logs. Query parameters also expose tickets to request logs. Disabling authentication removes identity protection. Document initialization preserves the existing website protocol without relying on native fragment conversion.

## Consequences

Only a desktop rebuild is needed. Server routes, expert sites and F12 settings remain unchanged. The bootstrap requires first-party session storage and an entry URL without an intervening path/query redirect. It does not establish which macOS or WebKit version causes the conversion. The existing view-lifecycle decision remains independent.

## Verification

Node VM tests execute the production bootstrap for initial delivery, reload, fresh launch, mismatched origin/path/query and frames. Rust tests validate bootstrap payloads and launch URL separation. Windows Rust tests pass; affected Mac installation and Windows/macOS/Linux native regression remain required before declaring the incident resolved.
