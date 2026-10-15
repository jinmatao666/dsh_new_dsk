# Agent Note: Automation editor portal navigation

Status: implemented

English | [中文](2026-10-15-automation-editor-portal-navigation.zh.md)

## Problem

Task editor options render in body portals to avoid dialog clipping. The feature page's capture-phase pointer listener treats an unowned portal as outside navigation and unmounts the editor before the option click, discarding its draft.

## Decision

Each task popover gives its mounted anchor a React-generated id and supplies that id through the existing `data-dsh-select-owner` marker. The shared interaction classifier can verify that the owner belongs to the active feature panel without a global exception for every dialog. Model, Workspace, permission, recurrence, time and validity controls share this mechanism.

## Alternatives considered

**Ignore every body dialog:** unrelated dialogs would incorrectly suppress normal page navigation. Ownership must resolve to a mounted feature descendant.

**Stop click propagation:** the page listens to pointerdown during capture, before click handlers run. Suppressing a later click cannot preserve the draft.

## Consequences

Popover selections preserve the page and draft. Escape still closes the popover; outside navigation, Back, logout and feature switching retain their existing behavior. Owner ids remain instance-local and disappear with the editor.

## Testing

A Loader-created real panel controller and the actual feature page, task editor and body portals verify pointerdown followed by click across all six selector types, draft-only changes and explicit navigation. Installed desktop acceptance remains a deployment check.
