# Agent Note: Desktop staging and migration file safety

Status: proposed

English | [中文](2026-09-27-wanwei-upgrade-files.zh.md)

## Problem

Runtime staging removes dependency links using recursive removal, which is inappropriate for Windows junctions. Legacy migration copies directly into final files, so interruption can leave a partial file that future migration treats as already present.

## Proposal

Unlink link-shaped staging entries and recursively remove only ordinary entries. Copy legacy files into exclusive same-directory temporary files, sync their bytes, and publish via a non-replacing hard link. Keep existing destination files unchanged and remove temporary names after handled success or failure.

## Alternatives considered

**Rename the temporary file.** Rename may replace existing destinations on Unix and violate the non-overwrite requirement.

**Write directly with exclusive creation.** This avoids replacement but still leaves partial final files after process interruption.

## Acceptance criteria

Real Windows junction tests preserve source packages. Migration tests preserve existing data, publish complete new data and remove failed temporary copies. macOS/Linux filesystem and installed upgrade checks remain separate acceptance work.

## Risks

Hard links must be supported by the application data filesystem. Unsupported filesystems fail migration without marking it complete. A force-terminated migration can leave a temporary file but cannot expose that partial file under the final name. This does not make a changing legacy SQLite database a consistent snapshot.
