# Agent Note: Skill category relation source

Status: implemented

English | [中文](2026-09-10-skill-category-relation-source.zh.md)

## Problem

The category-management list counted and expanded skills through the legacy `skills.category` display string while skill assignment used category relation IDs. A stale display string could therefore make a skill appear under `通用类` and `空间制图` at the same time. Category names and stable codes can also diverge after a rename, so treating the historical code `通用类` as default-category identity can reject operations on a differently named category.

## Decision

Category-management counts, expansion, and deletion checks read `skill_category_relations.category_id` as the authoritative skill-package assignment. The legacy `skills.category` field remains a display and compatibility field, synchronized by package assignment paths, but it is not used to infer an administrative binding. Primary-category operations resolve the displayed category name exactly; only the skill-package category named `通用类` receives default-category protection, and that name cannot be changed. The API returns this identity as `is_default`, which the category editor uses instead of inferring it from a code or local label. The category editor otherwise persists only the editable name and description, leaving the stable category code and type unchanged.

Category reads select distinct skill and category IDs. Batch category reads also select every ordered expression, as required by PostgreSQL for `SELECT DISTINCT`. Startup migration removes duplicate relation rows and removes relations left behind when duplicate categories are consolidated. A removal request carries both the category ID and displayed name. If historical response data paired the wrong ID with that name, the server resolves the named category from the skill's actual relations before replacing its primary-category relations with the default category.

The category table gives each expandable row a composite key made from its type, stable code, and database ID. A request sequence number prevents a slower response for an earlier row from replacing the currently expanded row. The skill-library page loads skills and category metadata independently, so failure of one endpoint does not discard successful data from the other.

## Alternatives considered

**Repair only the legacy display field.** Existing data can contain stale values until migration completes, and later writes could reintroduce the same mismatch. Administrative reads must use the normalized relation ID.

**Remove the legacy field immediately.** Existing marketplace APIs and package metadata still expose it, so removing it would broaden this bug fix into an incompatible API change.

**Write every category column during edit.** The editor has no controls for a category code or type. Rewriting those fields can conflict with historical database indexes without changing what the administrator selected.

**Use a category code as default-category identity.** Codes remain stable across renames and can preserve `通用类` after the category has a different visible meaning. Default protection follows the exact visible default name instead.

## Consequences

Each category row reflects the exact relationships used by marketplace filtering and downloads. Older display values, mismatched response IDs, and duplicate relation rows cannot create repeated expanded skills, make a skill appear in the wrong category, or make a non-default category inherit default-category restrictions. PostgreSQL can execute the distinct batch lookup, and a category-metadata error cannot blank the skill list. Fast row changes retain only the latest expansion response.
