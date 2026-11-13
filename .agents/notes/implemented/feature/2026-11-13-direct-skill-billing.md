# Agent Note: Charge direct skill instructions at model entry

Status: implemented

English | [中文](2026-11-13-direct-skill-billing.zh.md)

## Problem

Direct slash invocation already provides full skill instructions and tells the model not to load them again. Charging only the skill tool omits this legitimate use.

## Decision

The private accounting plugin observes newly logged skill-invocation messages in the active turn. Only messages present in the assembled model request can reserve credits. The first non-error provider chunk confirms use and settles those reservations; a failed entry releases them. A consumed message is removed from pending injections so later history reuse cannot charge it again. Retry attempts after failed entry use a new reservation identity. Skill-tool fees remain tied to their distinct call IDs.

## Alternatives considered

Forcing the model to reload instructions wastes tokens and does not enforce accounting. Charging at selection or injection alone would bill unsent or rejected requests.

## Consequences

Both paths use the same backend prices, task settlements, history and turn identifiers. Disabled accounting and zero-priced skills make no reservations. A later business failure does not undo successful skill use.
