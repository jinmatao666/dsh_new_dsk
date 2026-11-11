# Agent Note: Unified desktop account identity

Status: implemented

English | [中文](2026-11-11-unified-desktop-account.zh.md)

## Problem

SMS login could expose a local placeholder while settings showed the account-center username. Name changes could also change model-preference ownership.

## Decision

Username, phone/password, SMS and bound WeChat sign-in resolve to one account. Existing usernames survive binding. An absent username is initialized only from the account’s verified phone, under an account-row lock shared with identifier writes. WeChat polling reads current account-center identity and requires verified-phone binding before desktop session establishment. The WeChat nickname never supplies a username. Login and settings return the canonical username; account status and rename synchronize the shared desktop view and local credentials without accepting obsolete responses after logout.

Usernames accept 2–32 letters, Chinese characters, digits or underscores and remain unique. A phone-shaped username must be the account’s verified number. Model preferences use the backend address and stable product user ID, with migration from the previous username key for the current verified account.

## Alternatives considered

Overwriting the username at each sign-in would rename existing accounts when another sign-in method is used. Identifying accounts by mutable usernames would split preferences after a rename. Automatically merging accounts on binding conflicts could move data between separate owners.

## Consequences

No database schema change is required. The desktop and backend must be updated together. Account balances, permissions and user IDs remain attached to the original account. Local identity synchronization does not implement cross-device conversation synchronization. Real WeChat authorization and SMS delivery still require provider configuration; focused tests use mocked providers and local databases.
