"""Version-1 loopback HTTP adapter for Meta SAM3's Python image processor.

Run in the separately installed SAM3 environment, with local model weights.
This file owns no Buddy identity, tasks or downloads and never imports an expert.
"""
import base64
import hmac
import io
import json
import math
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

import numpy as np
from PIL import Image, ImageOps


def validate(payload):
    if not isinstance(payload, dict) or payload.get('schema_version') != 1:
        raise ValueError('schema_version must be 1')
    text, boxes = payload.get('text', ''), payload.get('boxes', [])
    precise, score = payload.get('return_masks', True), payload.get('score_threshold', 0.35)
    if not isinstance(text, str) or len(text) > 200 or not isinstance(boxes, list) or len(boxes) > 8 or bool(text.strip()) == bool(boxes):
        raise ValueError('provide one short text prompt OR 1-8 normalized xyxy boxes')
    if not isinstance(precise, bool) or isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0.1 <= score <= 0.95:
        raise ValueError('invalid return_masks or score_threshold')
    for box in boxes:
        if not isinstance(box, list) or len(box) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in box) or box[0] >= box[2] or box[1] >= box[3]:
            raise ValueError('invalid normalized xyxy box')
    data = base64.b64decode(payload['image'], validate=True)
    if not 0 < len(data) <= 12 * 1024 * 1024:
        raise ValueError('image too large')
    with Image.open(io.BytesIO(data)) as img:
        if img.format not in ('PNG', 'JPEG', 'WEBP') or getattr(img, 'n_frames', 1) != 1 or img.width * img.height > 1600 * 1600 or max(img.size) > 1600:
            raise ValueError('use a single image with longest side <=1600')
        image = ImageOps.exif_transpose(img).convert('RGB')
    return image, text.strip(), boxes, precise, score


def create_server(predict, address=('127.0.0.1', 3321), key=''):
    if address[0] not in ('127.0.0.1', '::1', 'localhost'):
        raise ValueError('bind this private model service to loopback only')
    lock = Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body):
            data = json.dumps(body, allow_nan=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.reply(200 if self.path == '/healthz' else 404,
                       {'service': 'sam3-http', 'schema_version': 1, 'model_loaded': True} if self.path == '/healthz' else {'error': 'not found'})

        def do_POST(self):
            self.connection.settimeout(15)
            if self.path != '/segment':
                return self.reply(404, {'error': 'not found'})
            if key and not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + key):
                return self.reply(401, {'error': 'unauthorized'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'JSON required'})
            if self.headers.get('Transfer-Encoding'):
                return self.reply(400, {'error': 'chunked body not accepted'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 18 * 1024 * 1024:
                    return self.reply(413, {'error': 'request too large'})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError('incomplete body')
                image, text, boxes, precise, score = validate(json.loads(raw))
            except (ValueError, TypeError, KeyError, OSError, Image.DecompressionBombError):
                return self.reply(400, {'error': 'invalid image or prompt; check adapter version-1 request'})
            if not lock.acquire(blocking=False):
                self.send_response(503)
                self.send_header('Retry-After', '5')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            try:
                objects = predict(image, text, boxes, precise, score)
                response = {'schema_version': 1, 'width': image.width, 'height': image.height, 'objects': objects}
                encoded = json.dumps(response, allow_nan=False).encode()
                if len(encoded) > 32 * 1024 * 1024:
                    return self.reply(422, {'error': 'response exceeds limit; crop image'})
                self.reply(200, response)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.reply(500, {'error': 'SAM3 inference failed; inspect model deployment, GPU capacity and input'})
            finally:
                lock.release()
    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    return server


def load_predictor():
    checkpoint = Path(os.environ.get('SAM3_CHECKPOINT', ''))
    if not checkpoint.is_file():
        raise SystemExit('SAM3_CHECKPOINT must point to downloaded local weights; automatic downloads are disabled.')
    import torch
    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor
    if not torch.cuda.is_available():
        raise SystemExit('CUDA is not available in this SAM3 environment.')
    bpe = os.environ.get('SAM3_BPE_PATH') or None
    if bpe and not Path(bpe).is_file():
        raise SystemExit('SAM3_BPE_PATH does not exist.')
    model = build_sam3_image_model(checkpoint_path=str(checkpoint), load_from_HF=False,
                                  bpe_path=bpe, device='cuda', compile=False)
    processor = Sam3Processor(model, device='cuda')

    def predict(image, text, boxes, precise, threshold):
        objects = []
        with torch.inference_mode(), torch.autocast('cuda', dtype=torch.bfloat16):
            state = processor.set_image(image)
            processor.set_confidence_threshold(threshold)
            prompts = [text] if text else boxes
            for prompt in prompts:
                processor.reset_all_prompts(state)
                if text:
                    result = processor.set_text_prompt(prompt=prompt, state=state)
                else:
                    x0, y0, x1, y1 = prompt
                    result = processor.add_geometric_prompt(box=[(x0+x1)/2, (y0+y1)/2, x1-x0, y1-y0], label=True, state=state)
                detected = result['boxes'].detach().float().cpu().numpy()
                scores = result['scores'].detach().float().cpu().numpy().reshape(-1)
                masks = result['masks'].detach().cpu().numpy() if precise else None
                for i, (box, score) in enumerate(zip(detected, scores)):
                    x0, y0, x1, y1 = [float(v) for v in box]
                    norm = [max(0, min(1, x0/image.width)), max(0, min(1, y0/image.height)),
                            max(0, min(1, x1/image.width)), max(0, min(1, y1/image.height))]
                    if norm[0] >= norm[2] or norm[1] >= norm[3]:
                        continue
                    obj = {'box': norm, 'score': float(score)}
                    if precise:
                        mask = np.asarray(masks[i]).reshape(image.height, image.width).astype(bool)
                        if not mask.any():
                            continue
                        stream = io.BytesIO()
                        Image.fromarray(mask.astype('uint8') * 255).save(stream, 'PNG')
                        obj['mask_png'] = base64.b64encode(stream.getvalue()).decode()
                    objects.append(obj)
                    if len(objects) > 50:
                        raise ValueError('more than 50 detections; crop the input')
        return objects
    return predict


if __name__ == '__main__':
    predictor = load_predictor()
    port = int(os.environ.get('SAM3_PORT', '3321'))
    app = create_server(predictor, ('127.0.0.1', port), os.environ.get('SAM3_SERVICE_KEY', ''))
    print(f'SAM3 loaded. Private version-1 endpoint: http://127.0.0.1:{port}/segment', flush=True)
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.server_close()
