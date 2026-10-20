# Agent Note: Marketplace panel scrolling

Status: implemented

English | [中文](2026-10-20-marketplace-panel-scroll.zh.md)

## Problem

The market renders its sections directly inside the shared feature panel, whose hidden overflow expects a separate body scroller. Without that body, content beyond the viewport is clipped and wheel input cannot reach lower skill cards.

## Decision

A marketplace-only panel class uses block layout, automatic vertical overflow and bottom padding. The existing catalog controls and SkillHub detail return retain the panel as their scroll-position owner. Shared feature-panel rules remain unchanged.

## Alternatives considered

**Change every feature panel:** other pages have their own body scrollers; enabling a second scroller would alter their layout.

**Wrap only the market body:** existing catalog controls and SkillHub details save and restore the panel's scrollTop. A new inner owner requires coordinated changes that are unnecessary for this repair.

## Consequences

The market heading and content scroll together, and sections keep their natural height. Other pages retain their existing scrolling behavior. No backend or installation-count semantics change.

## Testing

The owner-local browser regression uses the production shared and market styles at 600px and 900px heights. It checks wheel scrolling, keyboard access to the bottom, return to the top and uncompressed sections. Removing the market class is a negative control that reproduces the clipped page. This layout fixture does not replace installed-desktop acceptance.
