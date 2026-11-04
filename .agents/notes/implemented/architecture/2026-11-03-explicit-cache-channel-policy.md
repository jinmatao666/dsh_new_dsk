# Agent Note: Explicit cache channel policy

Status: implemented

English | [中文](2026-11-03-explicit-cache-channel-policy.zh.md)

## Problem

The model editor allows cache markers on self-hosted endpoints whose cache protocol is unknown. Its enable-model checkbox duplicates the model list action.

## Decision

The editor exposes an enable-explicit-cache dropdown and preserves model enabled state. Channel metadata supplies adapter eligibility without credentials; it does not prove model or regional support. The current policy permits the implemented Bailian protocol on official endpoints; generic compatible, self-hosted, and unadapted endpoints remain closed. New models and source changes default to off, including eligible channels. Administrators confirm model and regional support before manually enabling the option. Reopening preserves an eligible model's saved choice. Implicit caching and the desktop's reported cache-hit percentage remain independent of this switch.

Relay checks the actual channel before injecting cache markers, including for historical model records with caching enabled. This policy is an adapter restriction, not a live capability probe, and does not control implicit cache accounting.

## Alternatives considered

**Disable only the UI.** Rejected because historical settings could still inject unsupported cache markers on self-hosted channels.

## Consequences

Administrators control the supported dropdown while list actions own model enablement. Unknown endpoints cannot opt in until their protocol is adapted. Live model-specific detection remains a separate capability.
