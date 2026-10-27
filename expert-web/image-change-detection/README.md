# Image change discovery expert

English | [中文](README.zh.md)

This independent Buddy expert accepts ordered before/after images of the same scene. It registers the earlier image onto the later image, compensates global brightness, proposes visual differences and exports annotated output and relative coordinates. Precise mode intersects SAM3 masks from both periods with the neighborhood of the difference candidates. It is visual change screening, not a trained semantic change detector or evidence of a particular cause.

## Deployment

Copy `.env.example` to private `.env`. Configure this expert's provider credential and `SAM3_URL`, the full POST URL of the companion version-1 SAM3 adapter. `SAM3_KEY` is optional model-service authentication. No Qwen model is needed for this expert. Run `docker compose -p wanwei-image-change-detection build` and `docker compose -p wanwei-image-change-detection up -d`. The Dockerfile accepts `PYTHON_IMAGE` and `PIP_INDEX_URL`. Host network, `127.0.0.1:3314`, data volume `wanwei-image-change-detection-data`, gateway `/experts/image-change-detection/`, Cookie `expert_image_change_detection_session`. Each directory is independently buildable; no sibling source is loaded.

## Inference and coordinates

The adapter accepts `schema_version:1`, `image` (base64 PNG), `text:""`, `boxes` (up to eight normalized xyxy prompts), `return_masks:true` and `score_threshold`. Response requires `schema_version:1`, submitted `width`/`height` and `objects` containing normalized `box`, `score` and base64 `mask_png` at the same size. The packaged SAM3 adapter is a companion service, not an arbitrary third-party endpoint. An unavailable service or missing mask never falls back to fake precise output.

Coordinates and masks refer to the analyzed later image, with top-left origin and 0–1 normalized xyxy bounds. The earlier image is warped into that frame; `aligned-before.png` and its homography are exported. Inputs are orientation-corrected and bounded to 1600 pixels per side. Without registration, images must already be aligned and equally sized.

## Verification and limits

Run `python -m unittest -q test_vision` and `node --check web/app.js`. Fixture tests verify worker artifacts, coordinate range, two-image ownership and rejection of unalignable pairs. Live SAM3/GPU quality, actual Buddy tickets and native downloads require deployment acceptance. Low-texture pairs, insufficient overlap or excessive distortion fail explicitly; more than eight candidate regions require cropping or parameter adjustment. Shadows, seasons, parallax and exposure can create false positives. Binary masks are authoritative; exported contours are approximations and include hole flags. Cancelled tasks never expose results, but remote inference may continue. Preserve the volume and private configuration when updating.
