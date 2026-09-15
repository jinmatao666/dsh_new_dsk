# Agent Note: Bounded skill icon thumbnails

Status: implemented

English | [中文](2026-09-15-skill-icon-thumbnails.zh.md)

## Problem

The public skill-list response carries each icon inline. Administrator uploads stored the original raster as a data URL, so a small set of high-resolution icons could exceed the desktop OneAPI client's one-megabyte response limit and hide the complete remote skill catalog.

## Decision

The server retains built-in glyph keys and admitted PNG, JPEG, WebP, and GIF data URLs that already fit the limits. Oversized rasters become aspect-ratio-preserving PNG thumbnails. A thumbnail uses a maximum 96-pixel edge and steps down only when required to stay within 48 KiB as a data URL. Source images are limited to 16 million decoded pixels before full decoding. Unsupported or malformed values use the built-in default icon.

Metadata writes use the same normalization as package imports. Startup migration applies it idempotently to existing raster icons without advancing skill metadata timestamps, then the skill cache loads the compact values. The administration page continues to accept files up to 2 MiB and explains that the server creates the desktop thumbnail.

## Alternatives considered

**Raise the desktop response limit.** This retains multi-megabyte catalog responses and postpones the same failure as the catalog grows.

**Return no custom icons to existing desktop clients.** Replacing every raster with a glyph restores loading but discards the administrator's selected visual identity.

**Serve icons only from separate URLs.** Existing desktop renderers treat only glyph keys and raster data URLs as images. URL-backed icons require an installer update and a cache policy, while bounded thumbnails repair existing installations through a server deployment.

## Consequences

Public skill metadata remains below the response failure threshold for the current catalog, and each card keeps its selected image, aspect ratio, color, and transparency. Large animated GIFs become static PNG thumbnails. Invalid or unusually large decoded images fall back to the default glyph instead of consuming unbounded memory.
