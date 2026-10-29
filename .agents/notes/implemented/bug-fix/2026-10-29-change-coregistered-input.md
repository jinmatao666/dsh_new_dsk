# Agent Note: Accept coregistered change-analysis imagery

Status: implemented

English | [中文](2026-10-29-change-coregistered-input.zh.md)

## Problem

Users normally upload already registered image pairs. Requiring feature matching to succeed rejects valid pairs with seasonal or substantial land-use changes.

## Decision

Equal-sized pairs use original positions when no trustworthy extra correction exists. Metadata and the workbench explicitly state this assumption; equal size alone does not prove matching geography. Translation correction requires stronger correlation and bounded movement. Geometrically implausible corrections also retain original positions for equal-sized pairs. Different-sized unmatched inputs still fail. Pixels outside the common corrected footprint are made identical for both model inputs to avoid border artifacts.

## Alternatives considered

**Fail every unmatched pair** blocks normal pre-registered materials despite their valid pixel correspondence.

**Stretch every pair to one size** can introduce geometric errors and incorrectly implies registration.

## Consequences

The service remains usable for pre-registered imagery but cannot establish geographic correspondence from image dimensions alone. Users still need images of the same range. Actual model accuracy requires server inference.

## Testing

Regression tests cover low-texture same-size inputs, rejection of unmatched different sizes and recovery of a known translation. All eleven supplied real-image pairs pass registration/input handling; this does not measure change-detection accuracy.
