# Agent Note: Wanwei skill handoff and governed search

Status: implemented

English | [中文](2026-09-24-wanwei-skill-handoff-and-search.zh.md)

## Problem

The Wanwei desktop product needs a skill selected in its marketplace to become an editable Conversation draft before a Workspace exists. The product also needs review-result attention and the administrator-selected OneAPI search model without placing Wanwei behavior in official DSH packages.

## Decision

The staged input accepts an optional first-send Session factory. Only explicit Send or Enter invokes it; staging and editing create no Workspace. The marketplace keeps timestamp naming, native allocation and Workspace registration outside the generic composer. The factory does not inherit the previous conversation's Workspace; it allocates under the persistent product Harness home's `workspaces` directory, and exclusive creation numbers same-minute collisions. Normal registry persistence publishes the Workspace. Preparation is single-flight and freezes editing; failure retains the draft. Manual Workspace selection after launching the skill removes the factory without sending.

The official Conversation input resolver holds one pre-Session text draft and transfers it to a connected Workspace Session without submitting it. Its optional draft-prefix Slot receives the current text and a generic remove-prefix action. The official implementation has no skill or Wanwei knowledge and renders no prefix by default.

The Wanwei marketplace stages a selected skill's slash token, remembers its display name, and contributes its prefix presenter. It records review-result changes from successful owner-list fetches and clears attention when the matching approved or rejected filter is opened. The Wanwei OneAPI Host plugin registers the `oneapi-bailian` provider; the product bundle selects it over the official search provider. Each search reads the server's selected model and resolves the signed-in user's token at request time.

## Alternatives considered

Structured Bailian search results now become validated, deduplicated HTTP(S) sources in the existing tool result and persisted card metadata. The provider asks the model to cite these actual URLs beside supported claims. Missing sources explicitly warn against claiming verification. Loader composition tests cover tool output and presentation after JSON serialization; they do not validate a live model's citation choices.

**Copy the official composer into the product package.** This would avoid a small upstream interface change but create a second editor and input lifecycle to maintain.

**Put skill knowledge in the official composer.** This would make the marker easy to draw but violate the product boundary and couple upstream upgrades to marketplace semantics.

**Keep search configured through a local desktop key.** This would bypass the administrator's model policy and duplicate credential configuration.

**Extract sources from generated prose.** Rejected because a model-written URL is not evidence of retrieval and could be fabricated.

## Consequences

The product keeps the marketplace and OneAPI implementation outside the official packages. Generic draft state, first-send preparation and an optional presentation Slot remain target-neutral. A pre-Session draft remains local until Workspace selection or explicit first send; choosing a skill never sends it. Search requires a reachable OneAPI service and an authenticated token.
