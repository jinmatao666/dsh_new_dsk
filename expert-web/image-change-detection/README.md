# Image change discovery expert

English | [中文](README.zh.md)

## Workflow

A vision-capable Chat Completions model receives ordered before/after images. After optional registration it first discovers semantic change events, ignoring shadows, seasonal color and transient small objects. A second call localizes each candidate with normalized 0–999 coordinates. Continuous changes use region boxes; strongly overlapping duplicate boxes of the same category and change type are suppressed. Coordinates are model estimates requiring human review. Invalid, truncated or unlocalized responses fail explicitly; no pixel-difference or grid fallback fabricates detections.

Rectangle mode uses model boxes without SAM3. Precise mode sends candidate boxes to SAM3 for real masks, using the earlier image for disappeared targets. One event retains one result instead of splitting every mask fragment. JSON and CSV include change type, category and description. Model discovery/localization evidence, annotated image, aligned earlier image, comparison and diagnostic heatmap remain downloadable. Rectangle mode does not claim measured change area or output a synthetic mask.

## Deployment

Configure `EXPERT_MODEL_URL` (full Chat Completions endpoint), `EXPERT_MODEL`, and `EXPERT_MODEL_KEY` in private `.env`. The model must support two image inputs; a text-only model is insufficient. Loopback HTTP is accepted; remote HTTP requires `EXPERT_ALLOW_HTTP_MODEL=1`. Requests use server-owned credentials, bounded responses and no redirects. Model availability and actual image quality need target-server verification.

Precise mode additionally requires `SAM3_URL`, `SAM3_KEY` and `SAM3_API=deployed_v1` for the existing `/v1/images/segment` service; `adapter_v1` selects the older `/segment` API. No sibling source imports exist. Build and restart only this expert with `docker compose -p wanwei-image-change-detection up -d --build`. Preserve private configuration, volume `wanwei-image-change-detection-data`, loopback port 3314, gateway `/experts/image-change-detection/`, and cookie identity. The Dockerfile includes the independent semantic module.

## Verification and limits

Run `python -m unittest -q test_vision test_semantic` and `node --check web/app.js`. HTTP fixtures exercise actual worker subprocesses, both image inputs, candidate localization, real fixture masks, downloads and user isolation. Unit checks cover duplicate suppression, missing coordinates, invalid numbers and truncated replies. These tests do not validate real vision-model accuracy, SAM3 quality, GPU performance or production deployment. Discovery is bounded to 24 candidates and 8 locations per candidate. Excessive output fails rather than silently truncating. Low-texture same-size images may remain at existing pixel positions when alignment fails; review the aligned image. Model inference can continue remotely after local cancellation.
