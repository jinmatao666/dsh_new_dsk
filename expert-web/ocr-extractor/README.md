# OCR expert

English | [中文](README.zh.md)

This standalone Buddy workbench accepts PNG, JPEG, WebP, BMP, TIFF and unencrypted PDF documents: up to 20 files, 20 pages total, 50 MB total, and 20 million pixels per raster image. PDF pages are rendered locally at a maximum long side of 2000 pixels. Text-only PDF pages use their existing text layer; pages containing images or vector drawings use PaddleOCR to avoid skipping content. Text layers can themselves contain errors and require review.

## Recognition and exports

Configure `PADDLEOCR_API=layout` with the full PP-StructureV3 POST URL, such as `http://127.0.0.1:18082/layout-parsing`. The alternative general `/ocr` pipeline uses `PADDLEOCR_API=ocr`. The optional engine credential is `PADDLEOCR_KEY`. Layout inference has a 300-second request timeout; task workers have an 1800-second deadline. Custom field extraction requires a configured `EXPERT_MODEL_*` text model; images are never sent to that formatter. Missing values and confidence scores are not invented.

Exports include TXT, Markdown, JSON, CSV and Word, plus original text and structured evidence. Word exports contain readable text, not a reconstruction of the original layout. Markdown retains the layout service output where available. Multi-page evidence and CSV preserve original filenames and page numbers. Full-text extraction works without Qwen. Custom text formatting failures do not publish substitute results.

## Preview and downloads

Selected pictures are visible immediately. PDF/TIFF pages use the authenticated local preview endpoint without creating a recognition task or calling PaddleOCR. The file picker, page controls and expanded view also work for saved task inputs. Previews are not retained as tasks. Downloads are available on the recognition workbench and in the files page, where extension filters include historical PDF artifacts. New tasks cannot request PDF output.

Task names are optional. Empty names become the first filename without its extension plus `_YYYYMMDDHHmm`; the server fallback uses China Standard Time. Explicit names are preserved. The same naming and replacement rules apply to reruns.

## Tasks and access

A completed task can be rerun with the same uploaded files and changed settings. An explicit replacement ID, or an identical nonempty task name for the same user, replaces its history entry using a fresh run directory. Running tasks cannot be replaced or deleted; deleting a terminal task removes its record and files. Superseded directories expire after 24 hours. History and downloads remain user-scoped. Clipboard copying attempts the browser copy command before the secure Clipboard API, with manual selection as the final fallback.

## Deployment

Copy `.env.example` to private `.env`. Set this expert's own provider credential and engine URL. Loopback HTTP is supported; non-loopback HTTP engines require `EXPERT_ALLOW_HTTP_ENGINE=1`. The image includes the local document renderer and exporters. Build arguments `PYTHON_IMAGE` and `PIP_INDEX_URL` select download sources. Keep the Compose project name `wanwei-ocr-extractor` and volume `wanwei-ocr-extractor-data` during updates; never update with `down -v`. The service binds `127.0.0.1:3315` behind `/experts/ocr-extractor/`. Do not package `.env` or task data.

## Verification

Run `python -m unittest -q`, `node --check web/app.js` and `node --test test_frontend.mjs` from this directory. Tests use actual task subprocesses and HTTP fixtures; they do not validate real Paddle weights. `/healthz` is process liveness; `/readyz` checks configuration. Production acceptance still requires real model inference, Buddy ticket exchange and native downloads. Cancellation prevents publishing results but cannot recall an accepted remote inference request.
