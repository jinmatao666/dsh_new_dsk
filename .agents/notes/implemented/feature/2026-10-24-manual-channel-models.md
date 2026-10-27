# Agent Note: Manual model IDs without discovery

Status: implemented

English | [中文](2026-10-24-manual-channel-models.zh.md)

## Problem

Some upstream services expose inference without a model-list endpoint. Requiring discovery prevents administrators from configuring a known model ID.

## Decision

Channel saves accept an empty model list and create no empty-name routing entries. Single model creation requires an existing source channel and a nonempty model ID, but accepts IDs absent from that channel's discovery list. The editable model picker keeps existing IDs as suggestions and retains typed text on blur. Saving uses the existing source-binding API.

This relaxes the single-create membership rule in [channel-first configuration](2026-10-21-channel-model-configuration.md). Batch registration still uses configured candidates and checks membership.

## Alternatives considered

**Require channel-list edits first.** This adds a prerequisite unrelated to inference.

**Remove source-channel validation.** This would permit associations with missing channels.

## Consequences

Saving a manually entered ID does not prove upstream support. Administrators use connectivity tests to check availability. Existing enablement and source-routing rules still apply.

## Testing

React tests exercise saving a channel without discovery, manual model submission and source binding. Gin requests against a temporary database cover empty-channel persistence, rejection of missing source channels and empty model IDs, and creation of manual routing entries.
