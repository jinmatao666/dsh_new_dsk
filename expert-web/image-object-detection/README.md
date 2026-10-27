# Object detection expert

English | [中文](README.zh.md)

This standalone Buddy expert accepts one image and a short object target, calls the version-1 SAM3 HTTP adapter and exports actual annotated PNG and normalized coordinate JSON. Precise mode requires binary PNG masks and additionally exports `mask.png`; missing masks never become rectangle-shaped substitutes. Zero detections are a valid explicit empty result. Chinese targets require a configured text translator; English targets work without Qwen.

## Deployment

Keep all code and copied assets in this directory. Copy `.env.example` to private `.env`, configure this expert's provider credential, the full `SAM3_URL` POST endpoint and optional `SAM3_KEY`. Set `EXPERT_MODEL_*` only for Chinese-to-English target translation. The supplied adapter is [inference/sam3_http.py](inference/sam3_http.py); run it in a separately installed official SAM3 CUDA environment with local `SAM3_CHECKPOINT`. Its private loopback port defaults to 3321 and must be checked before use. It does not download weights or implement Buddy authentication.

Run `docker compose -p wanwei-image-object-detection build` and `docker compose -p wanwei-image-object-detection up -d`. Build arguments `PYTHON_IMAGE` and `PIP_INDEX_URL` select download sources. Host network, `127.0.0.1:3313`, volume `wanwei-image-object-detection-data`, gateway `/experts/image-object-detection/`, Cookie `expert_image_object_detection_session`. No root or sibling runtime imports exist. Keep project and volume names on updates.

## Version-1 inference API

POST `/segment`: `schema_version:1`, `image` (base64 PNG), `text` (English target), `boxes:[]`, `return_masks` (boolean), `score_threshold`. Optional Bearer authorization uses the SAM3 service key, not a Buddy provider credential. Response: `schema_version:1`, `width`, `height`, `objects:[{box:[x0,y0,x1,y1],score,mask_png}]`. Coordinates are normalized to 0–1; masks use the submitted image size and values 0/255. Generic SAM3 deployments are not automatically compatible with this custom HTTP API.

## Verification and limits

Run `python -m unittest -q test_vision`, `node --check web/app.js` and `python -m unittest discover -s inference -p 'test_*.py'`. Fixtures verify worker outputs, HTTP ownership and malformed-mask rejection, not GPU inference accuracy. Images are orientation corrected and scaled to a maximum side of 1600; JSON records analyzed and original dimensions. Up to 50 detections are accepted. Each expert owns sessions, SQLite tasks and downloads. The SAM3 adapter serializes GPU requests; simultaneous requests receive 503 and should be resubmitted. Production acceptance needs real weights, driver/VRAM checks and Buddy-to-model-to-file testing. See [Meta SAM3](https://github.com/facebookresearch/sam3).
