# Agent Note: Channel-first model configuration

Status: implemented

English | [中文](2026-10-21-channel-model-configuration.zh.md)

## Problem

The model page combines candidates from every channel, uses a browser-controlled datalist and creates one definition at a time. Filtering the table without filtering connectivity requests would still invoke unrelated upstream sources. Repeating partial registrations can duplicate definitions or overwrite existing model metadata.

## Decision

Use saved channel configuration as the candidate source, with an unpaginated secret-free catalog. Single creation gates a searchable equal-width menu on channel selection and validates that selection server-side. A channel filter controls model rows, displayed sources and connectivity test scope. The batch dialog requires explicit selection and per-model review before submitting one transactional registration per item.

Each registration verifies membership in the current channel configuration, creates a disabled definition and billing ratios atomically, or adds only a missing default-group binding to an existing definition. Repeats are no-ops. Failures remain visible and retry excludes completed items. The UI retains the existing admin palette and spacing; successful registration does not infer upstream access or vision capability.

## Alternatives considered

Automatically selecting discovered models conflates catalog visibility with authorization. Generating one alias per channel would decide the deferred routing and role-isolation design. Reusing separate metadata/source/option writes would leave partial new registrations. One transaction for the entire batch would roll back useful successful items because of one invalid model.

## Consequences

Configured membership is not an inference guarantee. New batch entries require explicit enablement. Default-group source creation preserves the existing group policy. Existing definitions and other bindings are not overwritten. The legacy single-save capability probe and general source-edit API remain unchanged. Bulk registration serializes within a process and locks option rows; legacy option-editor read/replace semantics and multi-replica in-memory cache convergence are outside this change.

## Testing

Real-page React tests cover filters, source-first selection, clearing stale IDs, explicit batch selection, retry behavior and search-only input. Real Gin requests against a temporary PostgreSQL schema verify registration, duplicates, source membership, preserved configuration, ratio rollback and a secret-free catalog. A local fake upstream verifies filtered tests exclude another channel. Headless browser review checks the real admin page, menu width, batch selection/review and absence of upstream discovery or capability probes during batch registration.
