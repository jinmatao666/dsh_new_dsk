# Agent Note: Final deliverable selection

Status: implemented

English | [中文](2026-09-30-final-deliverable-selection.zh.md)

## Problem

A tool-generated report can involve scratch text, intermediate Markdown, preview images and a final document. Listing every successful mutation as a deliverable buries the actual delivery behind process files.

## Decision

The deliverables plugin preserves successful mutation and runtime-output paths as recorded facts. It folds settled assistant responses into turn-local presentation data and selects recorded paths referenced by the closing response in reference order. Exact paths and unique basenames resolve; URI references require exact decoded paths. A response cannot invent a file. Without resolving references, document outputs take precedence; otherwise non-scratch recorded files remain eligible. Known scratch paths are excluded only from the delivery row. Prose links retain the complete recorded vocabulary.

## Alternatives considered

**Special-case one office skill.** This leaves other skills and ordinary conversations displaying the same intermediate files.

**Filter every source or Markdown file by extension.** Code and Markdown are legitimate final outputs, so explicit delivery references remain eligible.

**Delete intermediate files automatically.** File-generation dependencies and user-owned working data are not reliably identified by presentation rules. Filtering does not authorize disk deletion.

## Consequences

Primary outputs follow closing-reference order instead of creation order. Multiple final outputs remain possible. If the model omits references, document precedence is a heuristic and can omit a legitimate unreferenced supporting file; exact references avoid that ambiguity. Session data, tool history and files on disk remain unchanged. Regression tests exercise document-only delivery, multiple outputs, scratch filtering, ambiguous references, replay, live append and older-page loading.
