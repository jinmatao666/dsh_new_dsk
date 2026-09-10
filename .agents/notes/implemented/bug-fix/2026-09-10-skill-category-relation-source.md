# Agent Note: Skill category relation source
English | [中文](2026-09-10-skill-category-relation-source.zh.md)

Status: implemented

## Problem

The category-management list counted and expanded skills through the legacy `skills.category` display string while skill assignment used category relation IDs. A stale display string could therefore make a skill appear under `通用类` and `空间制图` at the same time.

## Decision

Category-management counts, expansion, and deletion checks read `skill_category_relations.category_id` as the authoritative skill-package assignment. The legacy `skills.category` field remains a display and compatibility field, synchronized by package assignment paths, but it is not used to infer an administrative binding. The category editor persists only the editable name and description, leaving the stable category code and type unchanged.

## Alternatives considered

**Repair only the legacy display field.** Existing data can contain stale values until migration completes, and later writes could reintroduce the same mismatch. Administrative reads must use the normalized relation ID.

**Remove the legacy field immediately.** Existing marketplace APIs and package metadata still expose it, so removing it would broaden this bug fix into an incompatible API change.

**Write every category column during edit.** The editor has no controls for a category code or type. Rewriting those fields can conflict with historical database indexes without changing what the administrator selected.

## Consequences

Each category row now reflects the exact relationships used by marketplace filtering and downloads. Older display values cannot create a duplicate category row or make a skill appear in the wrong expanded category.
