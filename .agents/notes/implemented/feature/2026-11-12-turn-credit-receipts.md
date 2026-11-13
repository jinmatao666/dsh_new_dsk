# Agent Note: Attribute settled credits to conversation turns

Status: implemented

English | [中文](2026-11-12-turn-credit-receipts.zh.md)

## Problem

A turn can include several model requests and skill charges. Comparing account balances also counts unrelated sessions and grants, and recalculating tokens with current prices changes historical costs.

## Decision

The loop supplies model-hidden session and turn identifiers. The pi-ai adapter forwards both as runtime-owned headers. OneAPI records them alongside model consumption; skill reservations carry the same pair. The authenticated turn-credit endpoint reads only that user's settled records and reports outstanding reservations separately. Business charges remain in shared credit history. Expert and knowledge developers may supply the same optional identifiers through the unified billing API.

The completed-turn usage slot hosts a compact total with a modal breakdown. Both accounting and credit visibility must be enabled. Unknown deployment policy hides the feature. Missing historical attribution is shown as unavailable records, not zero spending.

## Alternatives considered

Balance subtraction cannot isolate simultaneous sessions or gifts. Token estimates cannot reproduce successful skill charges or historical prices. Neither is used for the displayed cost.

## Consequences

Backend and desktop updates are both required for turn costs. Existing untagged records remain accessible through credit history. This attribution changes no prices, reservations or settlement amounts.
