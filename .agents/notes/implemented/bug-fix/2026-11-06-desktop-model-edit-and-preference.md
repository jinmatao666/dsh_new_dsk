# Agent Note: Desktop model editing and last-used defaults

Status: implemented

English | [中文](2026-11-06-desktop-model-edit-and-preference.zh.md)

## Problem

The old editor bypasses the creation form's test. Catalog refresh can also overwrite the model used in the last interactive prompt.

## Decision

The desktop custom model editor uses the same fields and connection test as creation. Saving writes back to the same provider route and requires a successful test of the current draft. The host can reuse a stored API key only at the saved endpoint. An endpoint change with a new key stages the new credential before changing the route.

Selecting a model in the composer changes that conversation. An accepted interactive prompt remembers its model for future conversations. Connector and scheduled prompts do not opt into this behavior. Desktop authentication preserves an available saved choice when refreshing managed models and restores each account's choice on the same installation. An unavailable choice falls back to the current server catalog when one is available.

## Alternatives considered

**Save on selection.** An unused pick or an automated task could change what the next chat opens with. The interactive prompt records the choice after admission.

## Consequences

Preferences are local to the installation and separated by backend and login name. Existing conversations keep their own model.
