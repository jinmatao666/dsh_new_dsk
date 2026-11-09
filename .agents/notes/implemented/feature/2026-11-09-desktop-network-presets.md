# Agent Note: Desktop network presets

Status: implemented

English | [中文](2026-11-09-desktop-network-presets.zh.md)

## Problem

The deployment mode can change without restoring the administrator's internet options or applying the agreed intranet defaults.

## Decision

The backend applies the preset only when entering intranet mode and preserves the saved internet feature flags. The preset enables automations, hides connectors and optional portals, and selects offline Python wheels. Desktop authentication and connector execution enforce the active policy, and browser traffic and web fetches check intranet destinations.

## Alternatives considered

**Apply the preset in the settings form.** An API caller could skip the form and leave a mixed deployment state, so the backend owns the transition.

## Consequences

Administrators may adjust settings while in intranet mode. Reentering intranet restores the preset. Model settings, portal addresses, uploaded files and account data are preserved. The application policy does not replace the deployment network perimeter.
