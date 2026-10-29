# Agent Note: PaddleOCR evidence and SAM3 image experts

Status: implemented

English | [中文](2026-10-27-paddleocr-sam3-experts.zh.md)

## Problem

Text generation from an image does not establish dedicated OCR recognition or genuine detection and segmentation artifacts. Independent experts need deployable image-service integration without adding image business logic to Buddy or OneAPI.

## Decision

This extends the image-service integration described in [the independent OCR note](2026-10-27-independent-ocr-expert.md); its identity, ownership and deployment boundaries remain applicable.

[OCR](../../../../expert-web/ocr-extractor/README.md) calls the official PaddleOCR general pipeline and preserves recognized text and line evidence. The optional Qwen formatter receives text only. [Object detection](../../../../expert-web/image-object-detection/README.md) and [change discovery](../../../../expert-web/image-change-detection/README.md) own separate websites, sessions, SQLite tasks, subprocesses and volumes. They call a versioned loopback SAM3 adapter over HTTP, never import sibling expert source. Image results contain normalized xyxy coordinates and actual PNG artifacts. Precise mode requires binary masks of the submitted dimensions; invalid results cannot fall back to fabricated masks.

## Alternatives considered

Directly treating arbitrary SAM3 HTTP deployments as interchangeable hides incompatible input and mask formats. Treating model coordinate estimates as surveyed geometry or a rectangle as a segmentation mask misrepresents the underlying inference. A shared source directory would prevent the expert directories from being deployed independently.

## Consequences

The SAM3 adapter loads administrator-provided local weights in a separate CUDA environment and serializes model requests. Code revision is recorded, but driver compatibility, VRAM and real model accuracy require target-host acceptance. Change discovery uses two-image semantic discovery followed by per-candidate model localization. Optional SAM3 masks refine the regions. These are model judgments requiring review; shadows, seasons and parallax remain false-positive sources. Empty results are explicit; model failure is not converted to successful sample output. Existing OCR task storage and volume identity are retained.

## Verification

HTTP fixtures exercise all three real worker subprocesses, generated artifacts, coordinate validation, two-image ownership, missing services, malformed engine responses, empty results and registration refusal. The SAM3 adapter is tested without Torch for request validation, bearer authentication and concurrent-request refusal. Headless Edge exercises detection and change login fixtures, uploads, result images, downloads, history and mobile overflow. These checks do not load PaddleOCR/SAM3 weights or prove real Buddy tickets, native downloads, CUDA performance or production deployment.

Change discovery now follows semantic vision-model discovery and per-candidate localization, inspired by the local qwen_change_app_bailian_local workflow. Pixel-difference candidates and grid grouping are removed. SAM3 only refines optional precise contours; model coordinates are estimates. See the change expert README for current limits and configuration. Fixture tests do not establish real model accuracy.
