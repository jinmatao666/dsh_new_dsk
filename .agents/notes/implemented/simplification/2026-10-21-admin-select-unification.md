# Agent Note: Unify admin selection controls

Status: implemented

English | [中文](2026-10-21-admin-select-unification.zh.md)

## Problem

Admin pages mix native selects, CustomSelect, Semi Select and Semantic selection dropdowns. Native menus are OS-dependent and do not match the rounded theme. Inline custom menus can be clipped inside scrolling forms or tables.

## Decision

Replace the remaining native selects in role permissions, expert categories, model configuration and usage with CustomSelect. Keep the option/value and event contracts, including disabled options and omitted option values. Render the custom listbox in a body portal, measure its trigger width, follow scroll/resize and flip above the trigger when necessary. Preserve keyboard selection, Escape, outside-click dismissal and focus restoration.

Apply shared admin CSS to retained Semi and Semantic controls instead of replacing their search and multi-select behavior. Menus use rounded corners, inset rows, pale-blue selection and soft shadows. Selection menus track trigger width; command menus retain content-appropriate sizing with the same rounded treatment. Dark mode and reduced motion remain supported.

## Alternatives considered

Styling native option elements does not reliably change platform-rendered menus. Replacing every component-library select would unnecessarily reimplement filtering and multi-selection. Shared styles plus targeted native replacements keep the existing behavior.

## Consequences

Selection widgets share the existing theme without changing backend configuration or data contracts. Portal menus are outside scrolling containers, so tests locate listboxes through their accessible IDs rather than relying on DOM ancestry.

## Verification

All 72 backend frontend tests pass, including new CustomSelect coverage and updated role/release regressions. The production frontend builds successfully. Headless browser checks exercise the built role modal at desktop and narrow widths and representative Semi/Semantic pages, checking menu alignment, corner radii, modal stacking and selection. No API or database change is required. These are local checks, not a production deployment.
