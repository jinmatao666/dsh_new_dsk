# Agent Note: Preserve SkillHub sections under restricted connectivity

Status: implemented

English | [中文](2026-10-30-intranet-catalog-placeholders.zh.md)

## Problem

Intranet hiding removed the entire SkillHub section, while disabled browsing exposed internal policy wording instead of showing available card metadata.

## Decision

Keep the discovery section and an availability placeholder when hidden. When disabled, render existing in-memory catalog metadata or local installed receipts as disabled cards without remote requests; use a placeholder if both are empty. Expert and skill placeholder copy describes network availability without exposing administrator display settings.

## Alternatives considered

Requesting an unavailable upstream to fill disabled cards delays the page. Fabricated cards misrepresent the catalog. Removing the section obscures the module's existence.

## Consequences

A cold start without local receipts uses a placeholder. Existing installation-list filtering stays unchanged. Card details, use and remote icons remain blocked under restricted access. Other automation work is outside this change.

## Testing

Focused client tests cover hidden sections, disabled loaded and installed cards, empty placeholders, blocked requests, connectivity restoration and expert placeholder copy. Existing disabled-card styles remain in use.
