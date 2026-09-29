# Agent Note: Rounded desktop dropdowns

Status: implemented

English | [中文](2026-09-28-rounded-desktop-select.zh.md)

## Problem

The desktop's native HTML selects had rounded triggers but Windows drew their option popups as square-cornered system menus, visibly disconnected from the product's other controls.

## Decision

The shared UI primitives package owns a token-styled single-choice `Select` with a rounded portaled list. Marketplace filters, installation-source filtering, skill creation, connector and automation forms, and model-provider settings use the same component. Existing already-styled menus keep their own interaction contracts.

The trigger retains focus for arrow-key navigation, Home/End, Enter, Space and Escape. The popup uses the theme's opaque menu surface and a minimum width that keeps short category labels readable. It chooses the side with room when opened and repositions on resize. Surrounding-page scrolling dismisses it instead of flipping its placement; scrolling options inside the popup keeps it open. A popup identifies its trigger through `data-dsh-select-owner`; marketplace dismissal resolves that owner before treating a portaled option as an outside click. Product plugins still own localized labels and choices.

## Verification

Component tests exercise pointer and keyboard selection, outside dismissal and disabled state. Marketplace and model-setting tests exercise the migrated callers. A Windows desktop visual pass is still needed to confirm scale and overlap in the packaged shell.
