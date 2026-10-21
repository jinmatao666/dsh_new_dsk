# Agent Note: Workspace-optional desktop composer

Status: implemented

English | [中文](2026-10-20-workspace-optional-composer.zh.md)

## Problem

New users have no Workspace. Session-only controls hide model, permission, file and skill choices. Empty staged skill labels also shift vertically when text appears.

## Decision

The product registers its existing timestamp-directory preparation as the default for all staged drafts. Typing and choosing models, permissions or skills create no directory or Session. Send prepares an ordinary Workspace Session; explicit Workspace selection bypasses automatic allocation. Pending model and permission choices apply before draft handoff, with failures preserving staged text.

The model seat reuses its Model/Effort menu. Permissions use Host-configured presets and the existing full-access confirmation. User-level skills have a Session-free catalog read. Connectors keep their Session-optional picker. Pre-Session file imports reuse the persistent native import location and append path mentions; live Session imports retain filename chips. Empty inline editors use a one-line baseline to keep skill labels aligned.

## Alternatives considered

**Create a Workspace on opening the composer.** This creates directories for abandoned drafts. **Invent a temporary Agent for selectors.** This duplicates lifecycle state and risks exposing an unintended execution directory. **Remove disabled styling only.** Controls still lack data and cannot transfer choices.

## Consequences

Feature plugins register disposable factories and transfer callbacks through the generic input service. The product allocator currently belongs to the skill-marketplace composition; deployments omitting that plugin must supply a factory. Authorization, model validation and native import checks remain enforced.

Focused tests cover ordinary and skill first sends, failed preparation and choices, Session-free catalogs and local model selection. Browser layout previews verify equal skill-label coordinates with and without text; toolbar labels in those previews are fixtures, not an installed-app screenshot. No live model or customer service was called.
