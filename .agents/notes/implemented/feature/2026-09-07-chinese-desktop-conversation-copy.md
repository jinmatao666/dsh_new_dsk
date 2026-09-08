# Agent Note: Chinese-first desktop conversation copy

Status: implemented

English | [中文](2026-09-07-chinese-desktop-conversation-copy.zh.md)

## Problem

The desktop application is deployed primarily to Chinese-speaking users, but the conversation flow still mixed Chinese responses with English slash-command descriptions, tool-row actions, and technical UI labels. The no-browser startup locale also opened in English, which made non-browser desktop paths inconsistent with the product language.

## Decision

Desktop conversation copy is Chinese-first. `zh` is the opening locale when neither the browser nor an explicit Host preference selects a shipped locale; `en` remains the dictionary fallback for a missing translation. Tool rows, skill rows, input/output labels, inspect actions, and the built-in `/goal`, `/permission`, `/plan`, and `/model` descriptions render Chinese business actions while retaining recognizable technical identifiers such as `Bash`, `Pwsh`, command names, paths, and field codes where they help users identify the operation. The desktop model instruction asks for concise Chinese visible updates and conclusions and forbids displaying internal reasoning or English inner-monologue scaffolding.

Raw server errors, command and tool identifiers, file paths, API names, shell syntax, package names, and data field codes remain verbatim. The client does not translate an error payload before showing it.

This supersedes the tool-title and opening-locale portions of [the full client locale rollout](../architecture/2026-07-30-client-locale-full-rollout.md); its typed locale mechanism and all other non-translation boundaries remain in force.

## Alternatives considered

- **Translate every technical token** — rejected. Altering commands, paths, field codes, or raw errors harms troubleshooting and makes copied instructions unreliable.
- **Keep English as the opening locale and only translate model prose** — rejected. Native and non-browser paths would still open with English client chrome.
- **Translate server-provided error text in the renderer** — rejected. The original diagnostic must remain searchable and auditable.

## Consequences

Chinese desktop sessions present a consistent action-oriented conversation surface without hiding the technical terms necessary for operation and support. English remains available through an explicit language preference or an English browser. New conversation-facing UI copy must use the typed locale seat and follow this split between Chinese business language and verbatim technical material.

## Verification

Focused locale, command, tool-row, and skill-row tests cover Chinese defaults, English fallback, localized known command metadata, and the Chinese tool and skill actions with retained technical identifiers. Contract type checking covers the cross-package locale keys.
