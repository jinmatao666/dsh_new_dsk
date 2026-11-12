# Agent Note: Account-owned knowledge plaza likes

Status: implemented

English | [中文](2026-11-12-knowledge-plaza-likes.zh.md)

## Problem

Page-local hearts lose the viewer’s preference on reload. Storing likes as subscription grants would let a preference change access rights.

## Decision

OneAPI stores likes by user id and library id, independently of subscriptions and grants. Authenticated POST and DELETE requests to `/api/knowledge-bases/:id/like` are idempotent and accept only libraries visible on the caller’s plaza. List and detail responses include `liked_by_viewer`. Deleting a library removes its likes.

Desktop cards place the heart at the right of the category row; details place it at the upper right of the left hero. Both share saved state. Hearts change after a successful save; failed requests keep the prior value and report an error. Loading the plaza restores the viewer’s saved preferences.

## Alternatives considered

Page state or local storage alone cannot provide account-owned preferences across devices. Subscription records couple preference to authorization.

## Consequences

A backend migration creates a separate table with a composite primary key. Likes neither submit subscriptions nor authorize document access. Model and HTTP tests cover idempotency and account isolation; desktop tests cover remount restoration, shared card/detail state and failed saves.

Local refresh runs TypeScript compilation before bundling, then builds OneAPI and restarts the backend and desktop through `scripts/start-wanwei.ps1 -Refresh`. Bundling alone can retain stale emitted authentication code and omit the like request handler.
