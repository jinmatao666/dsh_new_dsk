# Agent Note: Image expert task workflows and document exports

Status: implemented

English | [中文](2026-10-29-image-expert-task-workflows.zh.md)

## Problem

The image workbenches need usable repeated analysis, deletable history and interpretable exports. Single-image OCR excludes ordinary PDF documents, while a low fixed change-region limit prevents useful screening of larger image pairs.

## Decision

Each expert owns its copied assets, authentication, SQLite records and worker processes. Completed task inputs can be reused with different settings; same-user replacement creates a new run directory and replaces the history entry. Running records cannot be replaced or deleted. Deleting a terminal record removes its files; orphaned replacement directories expire after a day.

OCR renders bounded document pages locally, preserves original filenames/page numbers, and reads existing text only from text-only PDF pages. Mixed pages use PaddleOCR. Word/PDF exports contain text rather than reconstructed layout. Object detection translates common exact Chinese categories locally, removes near-identical duplicates conservatively, and exports original-image pixel boxes alongside relative coordinates.

Change screening estimates bounded translation before a similarity transform, with a same-position fallback for same-sized pairs. ECC inverse mapping is converted to the published before-to-after transform. Candidate batching removes the eight-region failure; grid grouping bounds the number of displayed regions. Color compensation and filtering reduce noise without claiming semantic accuracy. Comparison images and heatmaps expose the evidence for manual review.

## Alternatives considered

**Replacing input files in an existing run directory** allows an old worker to publish into a rerun; fresh run directories prevent that collision.

**Reading every PDF text layer** can omit words embedded in scanned or mixed-content pages. Pages with images or vector drawings continue through OCR.

**Treating every pixel difference as a real-world change** mislabels shadows and seasons; screening exports visual evidence and states that semantic accuracy needs acceptance on real imagery.

## Consequences

The experts remain independently deployable and retain existing project names and data volumes. OCR adds local rendering/export dependencies. Same-position fallback can produce false differences, and color normalization can suppress broad changes. Duplicate filtering can suppress very similar overlapping instances. The inference services remain separate deployments; no GPU accuracy claim follows from fixture tests.

## Testing

Python tests exercise actual worker subprocesses, task ownership, replacement/deletion, document exports, native PDF text, mixed pages, duplicate filtering, original coordinates and known translation recovery. OCR frontend checks validate static selectors, relative URLs and safe text rendering. Live Paddle/SAM3 inference and Buddy native downloads remain production acceptance work.
