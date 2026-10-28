# OCR expert

English | [中文](README.zh.md)

This independent Buddy workbench recognizes one PNG/JPEG/WebP image through an administrator-deployed PaddleOCR general pipeline. Qwen is optional for custom text-field extraction; image content is never sent to Qwen. Full-text TXT, Markdown, JSON and CSV work without Qwen. Markdown retains reading order and does not reconstruct table layout. Every successful task includes original OCR text and structured recognition evidence; generated fields require human review.

## Deployment

Copy `.env.example` to private `.env`. Configure the expert's own provider credential, `PADDLEOCR_URL` (the full POST `/ocr` URL) and optional `PADDLEOCR_KEY`. Existing `EXPERT_MODEL_*` settings serve only the custom text formatter. Loopback HTTP is supported; non-loopback HTTP engines require `EXPERT_ALLOW_HTTP_ENGINE=1`. Run `docker compose -p wanwei-ocr-extractor build` and `docker compose -p wanwei-ocr-extractor up -d` in this directory. The Dockerfile accepts `PYTHON_IMAGE` and `PIP_INDEX_URL` build arguments. Do not commit or package `.env`.

Linux host networking binds `127.0.0.1:3315`; persistent data uses `wanwei-ocr-extractor-data`. Keep the project name and volume across updates. Gateway path: `/experts/ocr-extractor/`; Cookie: `expert_ocr_extractor_session`. Existing completed task records remain readable. Preserve the old image and private configuration before an update. Never use `down -v` to update.

## Engine API

POST JSON `{"file":"<base64 image>","fileType":1}` using the optional engine Bearer credential. Require `result.ocrResults[0].prunedResult` with equally sized `rec_texts`, `rec_scores` and `rec_polys` arrays. Polygons must use the orientation-corrected input image's pixel coordinates. Malformed data, redirects, truncation or failed text formatting do not publish replacement results. Empty OCR output is reported as no recognized text. See the [official pipeline](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html).

## Verification and limits

Run `python -m unittest -q test_ocr`, `node --check web/app.js` and `node --test test_frontend.mjs`. Tests use HTTP fixtures and actual worker subprocesses, not Paddle weights. Production acceptance requires real OCR images, Buddy ticket exchange, task isolation, usage reporting and native download. `/healthz` is process liveness; `/readyz` checks configuration only. Image limits are 10MB and 20 million pixels. The UI sample is explicitly illustrative. Cancellation suppresses result publication but cannot recall an accepted remote request.

The deployed PP-StructureV3 service is supported with `PADDLEOCR_API=layout` and `PADDLEOCR_URL=http://127.0.0.1:18082/layout-parsing`. Requests send only base64 `file` and `fileType:1`; results use `result.layoutParsingResults`, `markdown.text` and `prunedResult.parsing_res_list`. Full Markdown preserves the service output. Raw layout data is retained; absent scores and normalized polygons stay null. Layout inference has a 300-second request timeout and a 390-second worker deadline. The general `/ocr` API remains selectable with `PADDLEOCR_API=ocr`. Image uploads remain single-image only; this integration does not enable PDF uploads.
