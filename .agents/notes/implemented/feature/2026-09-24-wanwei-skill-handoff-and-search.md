# Agent Note: Wanwei skill handoff and governed search

Status: implemented

English | [中文](2026-09-24-wanwei-skill-handoff-and-search.zh.md)

## Problem

The Wanwei desktop product needs a skill selected in its marketplace to become an editable Conversation draft before a Workspace exists. The product also needs review-result attention and the administrator-selected OneAPI search model without placing Wanwei behavior in official DSH packages.

## Decision

The official Conversation input resolver holds one pre-Session text draft and transfers it to a connected Workspace Session without submitting it. Its optional draft-prefix Slot receives the current text and a generic remove-prefix action. The official implementation has no skill or Wanwei knowledge and renders no prefix by default.

The Wanwei marketplace stages a selected skill's slash token, remembers its display name, and contributes its prefix presenter. It records review-result changes from successful owner-list fetches and clears attention when the matching approved or rejected filter is opened. The Wanwei OneAPI Host plugin registers the `oneapi-bailian` provider; the product bundle selects it over the official search provider. Each search reads the server's selected model and resolves the signed-in user's token at request time.

## Alternatives considered

**Copy the official composer into the product package.** This would avoid a small upstream interface change but create a second editor and input lifecycle to maintain.

**Put skill knowledge in the official composer.** This would make the marker easy to draw but violate the product boundary and couple upstream upgrades to marketplace semantics.

**Keep search configured through a local desktop key.** This would bypass the administrator's model policy and duplicate credential configuration.

## Consequences

The product keeps the marketplace and OneAPI implementation outside the official packages. The upstream compatibility list gains one generic draft store and one optional presentation Slot. A pre-Session draft remains local until the user selects a Workspace; it is never sent merely by choosing a skill. Search requires a reachable OneAPI service and an authenticated token.
