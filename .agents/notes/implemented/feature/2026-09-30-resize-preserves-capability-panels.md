# Agent Note: Column resizing preserves capability panels

Status: implemented

English | [中文](2026-09-30-resize-preserves-capability-panels.zh.md)

## Problem

The capability panel's document-level pointer listener treats column handles as external navigation. Beginning a sidebar resize therefore closes the active panel and reveals the underlying conversation.

## Decision

The marketplace interaction predicate recognizes AppFrame's sidebar and details `data-side` handles as layout-only interactions. The shared skill, expert, connector and automation panels remain mounted during resizing, preserving their local state. Sidebar navigation continues to close the panel.

## Alternatives considered

Stopping event propagation in AppFrame does not prevent a document capture listener from firing first. Replacing the shell or raising its handle changes official layout behavior without addressing the product-owned dismissal decision.

## Consequences

No official layout source or navigation state changes. The predicate depends on AppFrame's handle markers; a change to those markers requires updating the product predicate and browser regression together.

## Testing

The component regression checks both handles, nested event targets, filter preservation and normal sidebar dismissal. The desktop Loader/browser regression drags the actual sidebar handle with each capability panel open and checks panel identity, filter values, width changes and subsequent navigation.
