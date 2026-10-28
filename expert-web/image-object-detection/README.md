# Object detection expert

English | [中文](README.zh.md)

This standalone Buddy expert accepts one image and a short object target, calls the version-1 SAM3 HTTP adapter and exports actual annotated PNG and normalized coordinate JSON. Precise mode requires binary PNG masks and additionally exports `mask.png`; missing masks never become rectangle-shaped substitutes. Zero detections are a valid explicit empty result. Common exact Chinese categories are translated locally; other Chinese phrases require the text translator. English targets work without Qwen.

## Deployment

Keep all code and copied assets in this directory. Copy `.env.example` to private `.env`, configure this expert's provider credential, the full `SAM3_URL` POST endpoint and optional `SAM3_KEY`. Set `EXPERT_MODEL_*` only for Chinese-to-English target translation. The supplied adapter is [inference/sam3_http.py](inference/sam3_http.py); run it in a separately installed official SAM3 CUDA environment with local `SAM3_CHECKPOINT`. Its private loopback port defaults to 3321 and must be checked before use. It does not download weights or implement Buddy authentication.

Run `docker compose -p wanwei-image-object-detection build` and `docker compose -p wanwei-image-object-detection up -d`. Build arguments `PYTHON_IMAGE` and `PIP_INDEX_URL` select download sources. Host network, `127.0.0.1:3313`, volume `wanwei-image-object-detection-data`, gateway `/experts/image-object-detection/`, Cookie `expert_image_object_detection_session`. No root or sibling runtime imports exist. Keep project and volume names on updates.

## Version-1 inference API

POST `/segment`: `schema_version:1`, `image` (base64 PNG), `text` (English target), `boxes:[]`, `return_masks` (boolean), `score_threshold`. Optional Bearer authorization uses the SAM3 service key, not a Buddy provider credential. Response: `schema_version:1`, `width`, `height`, `objects:[{box:[x0,y0,x1,y1],score,mask_png}]`. Coordinates are normalized to 0–1; masks use the submitted image size and values 0/255. Generic SAM3 deployments are not automatically compatible with this custom HTTP API.

## Verification and limits

Run `python -m unittest -q test_vision`, `node --check web/app.js` and `python -m unittest discover -s inference -p 'test_*.py'`. Fixtures verify worker outputs, HTTP ownership and malformed-mask rejection, not GPU inference accuracy. Images are orientation corrected and scaled to a maximum side of 1600; JSON records analyzed and original dimensions. Up to 50 detections are accepted. Each expert owns sessions, SQLite tasks and downloads. The SAM3 adapter serializes GPU requests; simultaneous requests receive 503 and should be resubmitted. Production acceptance needs real weights, driver/VRAM checks and Buddy-to-model-to-file testing. See [Meta SAM3](https://github.com/facebookresearch/sam3).

## Deployed sam3-http:v1 service

The deployed service is selected with `SAM3_API=deployed_v1` and `SAM3_URL=http://127.0.0.1:8045/v1/images/segment`. It accepts `image_base64`, `prompt`, original-pixel `positive_boxes`, `confidence_threshold`, `max_detections:50`, `mask_format:png_base64` and `mask_space:original`. The adapter validates image/ROI dimensions and coordinate space, converts pixel boxes to normalized xyxy, and reads `instances[].mask.data` with mask size ordered as height,width. Truncated results and non-detector scores are rejected. Both experts use this existing service; no additional SAM3 adapter deployment is needed. The older `/segment` format described above is only selected by `SAM3_API=adapter_v1`. Body/form/help text uses the same larger, higher-contrast typography as the OCR workbench.

## Task lifecycle and result details

Completed tasks support changing settings and rerunning their saved input. An explicit replacement ID or the same nonempty name within one user replaces the history entry with a new run; active tasks cannot be replaced or deleted. Terminal tasks can be deleted with their files. Near-identical detections are suppressed at box IoU above 0.9; precise detections additionally require mask IoU above 0.9. Raw and suppressed counts are recorded. JSON/CSV include normalized boxes and pixel boxes in the EXIF-oriented original image, with exclusive right/bottom bounds. The workbench offers annotated/source/mask views, confidence distribution and a coordinate table. Confidence is a model score, not a measured accuracy rate.
