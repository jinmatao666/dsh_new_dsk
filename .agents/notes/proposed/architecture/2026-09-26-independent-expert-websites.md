# Agent Note: Independent expert websites

Status: proposed

English | [中文](2026-09-26-independent-expert-websites.zh.md)

## Problem

Expert workbenches embedded in the desktop source require a desktop release for each new expert. Shared source dependencies also prevent an expert team from moving its website to another repository. Users need the existing specialized workbenches, not replacement demonstration tasks.

## Proposal

Keep each expert's frontend, task backend, history, files, dependencies, tests and deployment configuration in its own child of `expert-web/`. Copy eligible legacy artwork into that child. No expert imports DSH, OneAPI or another expert's source. The platform owns only the published catalog and identity exchange; websites own task records and results.

The OneAPI administrator registers HTTPS workbench URLs dynamically. The desktop opens a published expert in a child Webview within the main-window Tab. The platform exchanges a short-lived, one-use ticket for a user ID through the website backend; it does not send the desktop token, model credentials or installation identity to the website.

The Wanwei product owns native commands and origin-specific capabilities. Official DSH packages receive only generic extension points when necessary. Publishing an expert grants privileged desktop access, so operators must review the deployed origin and scripts before publishing it. Navigation remains on the approved origin, and website CSP blocks third-party scripts and frames.

## Alternatives considered

**Keep six built-in workbenches.** This preserves familiar pages but binds expert updates and dependencies to desktop releases. The user requires independently movable websites and dynamically registered experts.

**Move task history into the platform.** This centralizes presentation but couples provider task models and storage to OneAPI and DSH. The user places history and results inside each website.

**Use a standalone expert window.** This avoids some child-Webview constraints but violates the required same-main-window Tab interaction. It is not an accepted fallback.

**Embed websites in the privileged main page as iframes.** This does not establish the required isolation from the main page's native capabilities, especially across Linux Webview implementations.

## Acceptance criteria

Each of the six websites installs, tests and deploys from a copy of its own directory, without the original repositories. Initial, preparation, active, error and result states are compared with the corresponding legacy workbench.

Document comparison preserves the legacy scope and supplementary requirements as operational inputs, not decorative fields. Its model analysis remains separate from deterministic text differences so generated interpretations cannot alter exact counts. Empty requirements permit text-only comparison; requested analysis fails explicitly when unavailable. Tests cover both-version input, parameter retention, output provenance and failure without invented analysis.

Original upload names remain display-only provenance in document and meeting reports and model requests. Numbered storage paths remain authoritative for reading files. This separation preserves readable citations without trusting upload names as filesystem paths; HTTP report tests verify the distinction through the worker process.

GIS experts also preserve the legacy model interpretation, not only tabular service responses. Each website owns its model adapter and domain rules, with no DSH source dependency. Interpretation uses only current complete service records, distinguishes facts from recommendations and rejects truncation; empty layers cannot establish absence of risk. Adapter tests alone do not satisfy task, report or webpage integration acceptance.

An administrator creates a previously unknown expert without a desktop code change. Its card, introduction and same-window Tab appear; identity exchange identifies the right user without exposing platform secrets. Concurrent redemption succeeds once, and expired, replayed, unpublished and mismatched requests fail.

Real task processing, uploads and downloads work on the target deployment. Windows, both macOS architectures and Linux demonstrate Tab switching, resizing, closing, logout and main-page overlays without covering or losing the sidebar. Old built-in experts are removed only after all six independent websites satisfy these checks.

Presentation rerenders preserve the expert website session rather than redeeming a used launch ticket again. Only a changed expert ID, URL or ticket replaces the native view. Closing the Tab silences pending positioning and visibility errors; tests distinguish these paths from a new launch.

Logout and catalog disposal invalidate outstanding launch requests before accepting their responses. A late response must not resurrect a privileged expert view or replace a current error notice. Component tests exercise successful dynamic discovery and both delayed success and failure after logout; native and Loader acceptance remain separate.

## Risks

The current local checks do not establish production readiness. Live model, ASR and GIS endpoints, container execution, actual LibreOffice conversion, complete visual comparison and cross-platform native interaction still require acceptance. SQLite identity tests do not prove behavior on a different production database.

Independent deployment adds ownership of TLS, secrets, quotas, backups, dependency licensing and operational monitoring to every expert. Website-owned task history is intentionally not a platform-wide task dashboard.

The user authorizes default desktop capabilities for published experts. An approved origin is consequently a privileged trust decision, not merely catalog metadata. No automatic deployment, commit, push or old-expert cutoff is authorized by this proposal.
