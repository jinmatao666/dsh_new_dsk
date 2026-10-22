# Agent Note: Sequential mirrors for desktop pip commands

Status: implemented

English | [中文](2026-10-21-pip-mirror-fallback.zh.md)

## Problem

The relay server can reach domestic PyPI mirrors quickly while official PyPI downloads time out. Multiple pip indexes do not express an ordered failover policy, and model-driven retries obscure which attempts actually succeeded.

## Decision

The OneAPI plugin's default configuration supplies Huawei Cloud, Tsinghua and official PyPI in that order. In intranet relay mode, a private Python module overlay delegates existing pip imports and supervises default-index `python -m pip download/install` in separate child processes. Each index receives one attempt with a complete 30-second budget. Network and unavailable-package diagnostics permit fallback; local permission, argument, build and integrity failures do not. The wrapper retains the configured proxy environment and never restores a direct-network route to recover a download. Explicit index/proxy choices and local installs delegate unchanged.

The overlay is scoped to the sidecar environment, removed on disposal, and disabled for offline resources and Internet mode. A credential-free JSON file beside its Python entry point carries the ordered indexes and timeout; production environment scrubbing can remove every ambient `DSH_*` variable without breaking the wrapper. A success marker prevents earlier failed attempts from triggering terminal dependency feedback. Backend configuration UI is not part of this implementation.

## Alternatives considered

**Extra indexes:** pip considers candidates across indexes rather than implementing the required primary/backup order, so this does not preserve latency control.

**Global pip configuration or installation edits:** these affect unrelated Python applications and outlive the selected desktop network policy. The process-local overlay preserves the existing installation.

**Model-directed source switching:** this depends on model compliance and can repeat failed commands without a fixed budget. The wrapper enforces the attempt order and exit status for the supported entry point.

## Consequences

The default route avoids slow official PyPI unless both domestic mirrors fail. Console `pip` launchers, isolated interpreters and overridden module paths do not receive automatic failover. Failed installs can leave pip-managed side effects; a retry does not provide transaction rollback. Source archives and platform-specific build requirements remain pip's responsibility. Native Windows process trees and POSIX process groups are terminated on attempt timeout.

## Verification

Real Python subprocess tests exercise primary success, ordered fallback, all-source failure, timeout, terminal failures, explicit-source and local-install passthrough, installed pip delegation, mode switching and overlay cleanup. Real shell execution after the production environment scrub and a fresh virtual environment both exercise ordered fallback without policy environment variables. A Loader-composed tool test verifies routing activation and recovered-result feedback. DLL-loading failures receive missing-dependency feedback rather than network feedback. Customer-server and packaged macOS/Linux acceptance remain external checks.
