# Agent Note: Remove the draft skill-selection dropdown

Status: implemented

English | [中文](2026-10-21-remove-draft-skill-selector.zh.md)

## Problem

The pre-Session composer exposes a separate skill-selection dropdown beside permissions. It duplicates the marketplace handoff and is not a requested product control. Using a skill without first choosing a Workspace does not require this dropdown.

## Decision

The marketplace plugin does not register the draft skill tool entry. Its picker component, locale entry and picker-only catalog request are removed. Marketplace Use skill still stages the reference; first send still prepares the normal Workspace and Session. Session `/` references and skill-chip navigation remain unchanged.

## Alternatives considered

**Hide or disable the picker after choosing a skill.** This retains an unwanted entry point and its request lifecycle. Removing the registration keeps the toolbar consistent before and after marketplace handoff.

## Consequences

The composer has one fewer control and no picker-triggered catalog request. The browser composition regression checks that the dropdown is absent on initial entry and after Use skill, alongside staged-reference navigation and removal. Skill installation and skill files are unaffected.
