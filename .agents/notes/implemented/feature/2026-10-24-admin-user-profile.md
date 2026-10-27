# Agent Note: Administrator user profile from observed activity

Status: implemented

English | [中文](2026-10-24-admin-user-profile.zh.md)

## Problem

The administrator's user list exposes account state and lifetime request totals but not how one user uses the available models, skills, and expert websites. Combining global usage pages by username risks mixing renamed accounts and unrelated events.

## Decision

The administrator-only [profile endpoint](../../../../services/one-api/controller/user_profile.go) groups model consumption logs, skill invocation events, and expert task-start events by the selected local user ID for the last 30 Beijing-calendar days. Skill downloads and recorded installations use their existing cumulative per-user counters. The [user-list dialog](../../../../services/one-api/web/air/src/pages/Zjugis/UserProfile.js) shows the period, counts, daily activity, named rankings, and a rule-based summary. It does not read prompts, files, or conversations or infer personal attributes.

## Alternatives considered

**Join the existing global usage API on username in the browser.** Usernames may change, the global API does not provide per-user model and download aggregates, and filtering client-side would expose unnecessary records.

**Generate free-form AI descriptions.** Activity counts do not justify inferred interests or job roles. The dialog uses literal, auditable descriptions of recorded events.

## Consequences

The profile is available from a user row without changing token-management actions. Model totals depend on consumption logging being enabled; missing records are presented as missing observations, not as proof of inactivity. Downloads are cumulative while other sections use a 30-day window. The endpoint has an isolated-user and date-window regression test; the dialog has a row-opening test.
