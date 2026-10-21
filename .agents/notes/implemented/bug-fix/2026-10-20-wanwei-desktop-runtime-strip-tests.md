# Agent Note: Packaged Wanwei desktop runtime must omit package tests

Status: implemented

English | [中文](2026-10-20-wanwei-desktop-runtime-strip-tests.zh.md)

## Problem

Windows NSIS installers failed with `Extract: error writing to file` on paths such as `resources\runtime-*\app\node_modules\@deepseek-ai\dsh-api-session-controller\tests\*.host.spec.ts`. Staging copied full workspace package trees into the runtime payload, so long test paths exceeded Windows MAX_PATH during extract.

## Decision

`prepare:runtime` skips development-only entries when restoring workspace packages and prunes `tests/`, `__tests__/`, and `*.spec.*` / `*.test.*` files from the staged app tree before DingTalk/WeCom asset staging. Helpers live in `products/wanwei-desktop/scripts/runtime-files.mjs`.

## Alternatives considered

**Enable Windows long-path support in the installer only:** rejected as incomplete; test files are unused at runtime and inflate the payload.

**Rely on each package `files` field alone:** rejected because `restoreWorkspaceClosure` copies workspace sources outside npm pack filtering.

## Consequences

Installer builds after this change must re-run `prepare:runtime`. Existing installers that already embed `tests/` remain broken on deep install paths until rebuilt.
