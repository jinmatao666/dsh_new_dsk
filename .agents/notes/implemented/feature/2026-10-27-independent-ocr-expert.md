# Agent Note: Independent OCR expert with explicit configuration failures

Status: implemented

English | [中文](2026-10-27-independent-ocr-expert.zh.md)

## Problem

A new OCR expert needs the existing desktop-to-website identity and file flow without adding expert-specific business code to DSH or OneAPI. A visual sample cannot establish OCR capability or serve as a fallback when the model is absent.

## Decision

[The OCR directory](../../../../expert-web/ocr-extractor/README.md) owns the website, SQLite sessions/tasks, image validation, subprocess worker, PaddleOCR adapter and optional text formatter, deployment files and copied first-party artwork. It does not import repository or sibling expert source. The page distinguishes an illustrative sample, a loopback-only fixture preview and real authenticated tasks. An unconfigured PaddleOCR endpoint rejects submission; invalid or truncated structured output cannot publish a successful result. OCR requests use server-owned PaddleOCR configuration and image content; optional formatting receives recognized text only, never browser-provided credentials.

## Alternatives considered

Embedding OCR into the platform couples independently deployable business logic to the directory service. Reusing a sibling expert through relative imports breaks directory portability. Generating sample output on model failure hides deployment defects and would falsely validate the integration chain.

## Consequences

The site can exercise identity, asynchronous task ownership and downloads with fixtures before a live model is chosen. Real OCR remains conditional on a deployed compatible PaddleOCR service; custom extraction additionally requires a configured text formatter. This adds a separately maintained service, dependency and data-volume lifecycle. HTTP is supported for the existing environment but does not protect transmission; shared-origin hosting requires reviewed first-party code. Cancellation suppresses publication, not already accepted remote inference.

## Verification

The local Python suite verifies actual fixture HTTP and worker subprocess output, upload rejection, ticket replay, origin checks, user isolation, cancellation and completed-task persistence. Node checks cover relative paths, resources and sample/result separation. Headless Edge checks cover settings, sample isolation, navigation and desktop/tablet/mobile layouts. Live model quality, real platform ticket redemption, production usage delivery, Docker/Nginx deployment and native desktop downloads remain target-environment acceptance work.

## Related image experts

The independent [object detection](../../../../expert-web/image-object-detection/README.md) and [change detection](../../../../expert-web/image-change-detection/README.md) sites retain the same identity, task ownership, isolated worker and download boundaries, each owning its source and data volume. Object detection uses a versioned SAM3 HTTP API; precise results require real binary masks. Change detection registers images and compensates brightness before proposing difference candidates; precise mode filters using masks from both periods, without interpreting visual differences as a confirmed semantic cause. The SAM3 adapter requires a separately installed official environment and weights. Fixtures verify artifacts and error handling; real GPU inference, production tickets, Docker/Nginx and native downloads remain deployment acceptance work.
