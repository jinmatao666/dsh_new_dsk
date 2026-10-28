# Image change discovery expert

English | [中文](README.zh.md)

This independent Buddy expert accepts ordered before/after images of the same scene. It registers the earlier image onto the later image, compensates global brightness, proposes visual differences and exports annotated output and relative coordinates. Precise mode intersects SAM3 masks from both periods with the neighborhood of the difference candidates. It is visual change screening, not a trained semantic change detector or evidence of a particular cause.

## Deployment

Copy `.env.example` to private `.env`. Configure this expert's provider credential and `SAM3_URL`, the full POST URL of the companion version-1 SAM3 adapter. `SAM3_KEY` is optional model-service authentication. No Qwen model is needed for this expert. Run `docker compose -p wanwei-image-change-detection build` and `docker compose -p wanwei-image-change-detection up -d`. The Dockerfile accepts `PYTHON_IMAGE` and `PIP_INDEX_URL`. Host network, `127.0.0.1:3314`, data volume `wanwei-image-change-detection-data`, gateway `/experts/image-change-detection/`, Cookie `expert_image_change_detection_session`. Each directory is independently buildable; no sibling source is loaded.

## Inference and coordinates

The adapter accepts `schema_version:1`, `image` (base64 PNG), `text:""`, `boxes` (up to eight normalized xyxy prompts), `return_masks:true` and `score_threshold`. Response requires `schema_version:1`, submitted `width`/`height` and `objects` containing normalized `box`, `score` and base64 `mask_png` at the same size. The packaged SAM3 adapter is a companion service, not an arbitrary third-party endpoint. An unavailable service or missing mask never falls back to fake precise output.

Coordinates and masks refer to the analyzed later image, with top-left origin and 0–1 normalized xyxy bounds. The earlier image is warped into that frame; `aligned-before.png` and its homography are exported. Inputs are orientation-corrected and bounded to 1600 pixels per side. Without registration, images must already be aligned and equally sized.

## Verification and limits

Run `python -m unittest -q test_vision` and `node --check web/app.js`. Fixture tests verify worker artifacts, coordinate range, two-image ownership and bounded translation registration and fallback behavior. Live SAM3/GPU quality, actual Buddy tickets and native downloads require deployment acceptance. Same-size pairs without a reliable transform continue at their existing pixel positions; the alignment note flags this possibility. Insufficient overlap or excessive distortion fail explicitly. Candidates are processed in batches; above 128 connected regions, an 8-by-8 grid groups the retained pixels for display. Shadows, seasons, parallax and exposure can create false positives. Binary masks are authoritative; exported contours are approximations and include hole flags. Cancelled tasks never expose results, but remote inference may continue. Preserve the volume and private configuration when updating.

## Deployed sam3-http:v1 service

The deployed service is selected with `SAM3_API=deployed_v1` and `SAM3_URL=http://127.0.0.1:8045/v1/images/segment`. It accepts `image_base64`, `prompt`, original-pixel `positive_boxes`, `confidence_threshold`, `max_detections:50`, `mask_format:png_base64` and `mask_space:original`. The adapter validates image/ROI dimensions and coordinate space, converts pixel boxes to normalized xyxy, and reads `instances[].mask.data` with mask size ordered as height,width. Truncated results and non-detector scores are rejected. Both experts use this existing service; no additional SAM3 adapter deployment is needed. The older `/segment` format described above is only selected by `SAM3_API=adapter_v1`. Body/form/help text uses the same larger, higher-contrast typography as the OCR workbench.

## Task lifecycle and visual review

Completed tasks can rerun saved images with changed settings, replacing their history entry by explicit ID or the same nonempty task name within one user. Active tasks cannot be replaced or deleted; terminal records and files can be deleted. Registration estimates a bounded translation first, then a similarity transform. Same-size pairs without a reliable estimate continue at existing pixel positions; this is a candidate-screening fallback, not evidence of alignment. Brightness/contrast compensation and region filtering reduce appearance noise but can hide broad changes. Review the aligned-before image, side-by-side comparison, difference heatmap, binary mask, coordinate CSV and JSON. More than eight candidates are processed in batches; above 128 components, grid grouping preserves retained pixels while changing the displayed region count. Real SAM3 precision and semantic change accuracy still require server acceptance.
