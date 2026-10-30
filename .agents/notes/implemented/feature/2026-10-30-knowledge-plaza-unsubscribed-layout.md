# Agent Note: Unsubscribed plaza detail split and maintainer display name

Status: implemented

English | [中文](2026-10-30-knowledge-plaza-unsubscribed-layout.zh.md)

## Problem

Unsubscribed plaza detail stacked cover, meta, and the file catalog in one narrow column, leaving empty space where the subscribed Q&A pane would sit. Plaza maintainer labels could also show login usernames when the authoritative display name lived only in the account center.

## Decision

Pending or none plaza detail uses class `with-files`: left column is the cover hero, title, maintainer display name, description, stats, and subscribe control; right column is the read-only content tree. Approved and owned detail keeps `with-chat` (files under the left hero, Q&A on the right) per [plaza subscribed Q&A](2026-10-29-knowledge-plaza-subscribed-qa.md). `userDisplayNames` overlays account-center identity before preferring `display_name` over `username` for `owner_username` on plaza and managed list rows.

## Alternatives considered

Keep a single-column unsubscribed detail — rejected; the empty right side next to subscribed layouts looked unfinished. Show login username with an `@` handle — rejected; product wants the same display name users see elsewhere.

## Consequences

Desktop Client CSS and plaza detail markup must ship with the OneAPI overlay change. Card meta still shows 维护者; detail shows it once above the description.

## Required verification

Open an unsubscribed plaza card and confirm left cover/meta and right file list fill the width, with the maintainer shown as the account display name. Open an approved card and confirm Q&A remains on the right with files under the left hero.
