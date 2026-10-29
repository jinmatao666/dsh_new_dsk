# Agent Note: Change analysis result presentation and deliverable management

Status: implemented

English | [中文](2026-10-29-change-deliverable-management.zh.md)

## Problem

Large overlapping boxes obscure change imagery, box counts do not explain segmentation, and one card per generated file makes downloading and deleting a task's deliverables difficult.

## Decision

The workbench defaults to conservative registration with an explicit same-position assumption for equal-sized pre-registered inputs, fills blank names from the before image and minute timestamp, and places image-view controls next to the image. Counts represent semantic events. Precise results show colored masks and outlines, compare temporal masks for expansion/shrinkage/modification, merge near-identical same-class event masks, and deduplicate pixels in total area. Box mode hides area statistics.

Chinese artifact names are shared by HTTP downloads and ZIP entries. The files page groups each task into one row ordered by completion time. ZIPs contain actual published outputs. Authenticated output deletion holds the worker lock and a SQLite transaction, clears the output directory/list, and retains source inputs and the task for rerunning. Existing tasks gain completion/deletion metadata by additive migration. Deleted result and bundle requests return 410; ownership checks precede mutation.

## Alternatives considered

**Counting bounding boxes or connected mask fragments** confuses one semantic event with multiple detections and can inflate counts.

**Summing per-event areas** counts overlaps repeatedly; union masks define the total.

**Deleting the entire task when removing deliverables** discards source material and prevents rerunning without another upload.

## Consequences

Precise temporal differences can inherit segmentation errors and still require real-image review. Different events may overlap legitimately. Legacy tasks without completion timestamps fall back to creation time. ZIPs are generated in memory with a 120 MB source cap. Local HTTP fixtures verify integration rather than real visual-model or SAM3 accuracy.

## Testing

Tests cover ZIP Chinese entries, omission of absent masks, cross-user denial, output deletion, preserved inputs, 410 responses and rerunning after deletion. Synthetic masks verify expanded-area subtraction and duplicate-event merging; registration tests reject unalignable different images. Browser checks cover layout, ZIP actions, compact downloads, sorting and deletion state.
