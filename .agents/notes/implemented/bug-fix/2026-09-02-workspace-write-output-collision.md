# Agent Note: Ask before workspace-write output collisions

Status: implemented

English | [中文](2026-09-02-workspace-write-output-collision.zh.md)

## Problem

The filesystem observation policy correctly rejected an unobserved overwrite, but the model had to notice and recover from the resulting error. A Workspace Write user therefore saw a failed Write card instead of being asked what should happen to an existing output file.

## Decision

The `write` tool now checks the resolved target before requesting its mutation intent. In Workspace Write mode, an existing regular file opens a user question with create-new-version, overwrite, and cancel choices. Creating a version searches sibling names such as `report (2).docx`; overwriting reads the existing file before the guarded replacement. In every non-interactive mode, including full access, the tool reads an existing regular file and then writes it without asking.

## Alternatives considered

**Keep the instruction prompt only.** Rejected because a model can attempt the mutation without an earlier read, producing the policy error before it can ask the user.

**Always create a numbered file.** Rejected because a user may explicitly want to replace a generated draft, and Workspace Write requires that decision to remain visible.

## Consequences

Workspace Write now pauses before a same-name regular-file write and preserves the current file unless the user chooses overwrite. Full access remains uninterrupted while still satisfying the freshness observation needed for safe replacement. A concurrent change between preflight and write continues to fail through the existing version guard rather than silently clobbering data.
