"""Fixture engines test app integration, not SAM3 accuracy or real GPU execution."""
import base64
import http.cookiejar
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import numpy as np
from PIL import Image
from ocr import MODE, OCRError, change_candidates, extract, sam_segment, validate_options
from server import create_server


def png(changed=False):
    image = Image.new('RGB', (120, 100), 'white')
    if changed:
        from PIL import ImageDraw
        ImageDraw.Draw(image).rectangle((25, 25, 65, 65), fill='black')
    out = io.BytesIO()
    image.save(out, 'PNG')
    return out.getvalue()


class Engine(BaseHTTPRequestHandler):
    requests_seen = []
    def log_message(self, *args):
        pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.requests_seen.append((self.path, body, self.headers.get('Authorization')))
        if self.path.endswith('/usage'):
            result = {'success': True}
        elif self.path == '/format':
            result = {'choices': [{'finish_reason': 'stop', 'message': {'content': 'car'}}]}
        else:
            image = Image.open(io.BytesIO(base64.b64decode(body.get('image', body.get('image_base64')))))
            obj = {'box': [0.2, 0.2, 0.7, 0.7], 'score': 0.9}
            if body.get('return_masks', True):
                from PIL import ImageDraw
                mask = Image.new('L', image.size)
                ImageDraw.Draw(mask).rectangle((24, 20, 83, 69), fill=255)
                out = io.BytesIO()
                mask.save(out, 'PNG')
                obj['mask_png'] = base64.b64encode(out.getvalue()).decode()
            result = {'schema_version': 1, 'width': image.width, 'height': image.height,
                      'objects': [] if body.get('text') == 'nothing' else [obj]}
            if self.path == '/malformed':
                result['width'] += 1
            if self.path == '/missing-mask':
                obj.pop('mask_png', None)
            if self.path == '/v1/images/segment':
                result = {'original_size': list(image.size), 'roi_xyxy': [0, 0, *image.size],
                          'mask_size': list(image.size), 'mask_coordinate_space': 'original',
                          'box_coordinate_space': 'original', 'total_detections': 1,
                          'instances': [{'object_id': 1, 'score': .9, 'score_source': 'detector',
                            'box_xyxy': [24, 20, 84, 70],
                            'mask': {'format': 'png_base64', 'size': [image.height, image.width], 'data': obj['mask_png']}}]}
        data = json.dumps(result).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Integration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = ThreadingHTTPServer(('127.0.0.1', 0), Engine)
        threading.Thread(target=self.engine.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{self.engine.server_port}'
        self.env = patch.dict(os.environ, {
            'SAM3_URL': url + '/segment', 'SAM3_KEY': 'fixture-engine-secret',
            'EXPERT_PUBLIC_URL': 'http://platform.test',
            'EXPERT_PLATFORM_REDEEM_URL': url + '/platform/redeem',
            'EXPERT_PROVIDER_CREDENTIAL': 'fixture-platform-secret',
            'EXPERT_MODEL_URL': url + '/format', 'EXPERT_MODEL': 'fixture-text', 'EXPERT_MODEL_KEY': '',
            'OPENBLAS_NUM_THREADS': '2', 'OMP_NUM_THREADS': '2'})
        self.env.start()
        self.app = create_server(Path(self.tmp.name) / 'data', ('127.0.0.1', 0),
                                 redeem_ticket=lambda ticket: {'user_id': '2' if ticket[0] == 'b' else '1'},
                                 public_url='http://platform.test')
        threading.Thread(target=self.app.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.app.server_port}'
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def tearDown(self):
        self.app.shutdown(); self.app.server_close(); self.app.worker.close()
        self.engine.shutdown(); self.engine.server_close()
        self.env.stop(); self.tmp.cleanup()

    def request(self, path, body=None, client=None):
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={'Origin': 'http://platform.test', 'Content-Type': 'application/json'})
        try:
            with (client or self.client).open(req, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def login(self):
        self.assertEqual(self.request('/api/session', {'ticket': 'a' * 64})[0], 200)

    def upload(self, precise=False):
        files = [{'name': 'before.png', 'content': base64.b64encode(png()).decode()}]
        if MODE == 'change':
            files.append({'name': 'after.png', 'content': base64.b64encode(png(True)).decode()})
        return self.request('/api/tasks', {'tool': MODE, 'files': files,
                           'options': {'target': 'car', 'precise': precise, 'align': False}})

    def wait(self, task_id):
        for _ in range(100):
            task = self.app.store.task('1', task_id)
            if task['state'] not in ('running', 'queued'):
                self.assertEqual(task['state'], 'succeeded', task.get('error'))
                return task
            time.sleep(.1)
        self.fail('fixture task did not complete')

    def test_actual_worker_outputs_download_and_user_isolation(self):
        self.login()
        status, raw = self.upload(precise=True)
        self.assertEqual(status, 201, raw)
        task_id = json.loads(raw)['id']
        task = self.wait(task_id)
        self.assertIn('annotated.png', task['outputs'])
        self.assertIn('mask.png', task['outputs'])
        status, raw = self.request(f'/api/tasks/{task_id}/result')
        self.assertEqual(status, 200)
        result = json.loads(json.loads(raw)['text'])
        self.assertGreater(result['count'], 0)
        self.assertTrue(all(0 <= value <= 1 for item in result['objects'] for value in item['box']))
        status, raw = self.request(f'/api/tasks/{task_id}/files/1')
        self.assertEqual(status, 200)
        self.assertEqual(Image.open(io.BytesIO(raw)).format, 'PNG')
        other = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.request('/api/session', {'ticket': 'b' * 64}, other)
        self.assertEqual(self.request(f'/api/tasks/{task_id}/files/1', client=other)[0], 404)
        self.assertEqual(self.request(f'/api/tasks/{task_id}/image', client=other)[0], 404)
        if MODE == 'change':
            self.assertEqual(self.request(f'/api/tasks/{task_id}/image2')[0], 200)
            self.assertEqual(self.request(f'/api/tasks/{task_id}/image2', client=other)[0], 404)

    def test_wrong_count_options_and_unauthenticated_upload(self):
        self.assertEqual(self.upload()[0], 401)
        self.login()
        self.assertEqual(self.request('/api/tasks', {'tool': MODE, 'files': [], 'options': {'target': 'car'}})[0], 400)
        for options in ({'target': 'car', 'precise': 'true'}, {'target': 'car', 'score': float('nan')}, {'target': 'car', 'threshold': 999}):
            with self.assertRaises(OCRError):
                validate_options(options)

    def test_schema_mismatch_is_not_success(self):
        with patch.dict(os.environ, {'SAM3_URL': os.environ['SAM3_URL'].replace('/segment', '/malformed')}):
            with self.assertRaises(OCRError):
                sam_segment(Image.new('RGB', (120, 100)), prompt='car')

    def test_missing_service_blocks_submission(self):
        self.login()
        with patch.dict(os.environ, {'SAM3_URL': ''}):
            self.assertEqual(self.upload()[0], 503)

    def test_precise_mode_never_substitutes_a_box_for_missing_mask(self):
        with patch.dict(os.environ, {'SAM3_URL': os.environ['SAM3_URL'].replace('/segment', '/missing-mask')}):
            with self.assertRaises(OCRError):
                sam_segment(Image.new('RGB', (120, 100)), prompt='car', precise=True)

    def test_deployed_service_actual_worker_and_coordinate_conversion(self):
        self.login()
        Engine.requests_seen = []
        endpoint = os.environ['SAM3_URL'].replace('/segment', '/v1/images/segment')
        with patch.dict(os.environ, {'SAM3_API': 'deployed_v1', 'SAM3_URL': endpoint}):
            status, raw = self.upload(precise=True)
            self.assertEqual(status, 201, raw)
            task = self.wait(json.loads(raw)['id'])
        self.assertIn('mask.png', task['outputs'])
        calls = [body for path, body, _ in Engine.requests_seen if path == '/v1/images/segment']
        self.assertTrue(calls)
        self.assertEqual(calls[0]['mask_space'], 'original')
        self.assertNotIn('schema_version', calls[0])
        self.assertIn('image_base64', calls[0])
        spec = json.loads((Path(__file__).parent / 'sam3-api-schema.json').read_text(encoding='utf-8'))['components']['schemas']['ConceptRequest']
        for call in calls:
            self.assertTrue(set(call).issubset(spec['properties']))
            self.assertTrue(set(spec['required']).issubset(call))
        if MODE == 'change':
            self.assertEqual(calls[0]['prompt'], '')
            self.assertGreater(calls[0]['positive_boxes'][0][2], 1)
        else:
            self.assertEqual(calls[0]['prompt'], 'car')

    def test_deployed_rejects_pixel_mask_orientation_and_truncated_result(self):
        from sam3_deployed import recognize
        base = {'original_size': [120,100], 'roi_xyxy': [0,0,120,100], 'mask_size': [120,100],
                'mask_coordinate_space': 'original', 'total_detections': 0, 'instances': []}
        from service_http import ServiceError
        with patch('sam3_deployed.post_json', return_value=base):
            self.assertEqual(recognize(Image.new('RGB',(120,100)), '', 'car', [], .35)['objects'], [])
        for changes in ({'original_size':[100,120]}, {'mask_coordinate_space':'roi'}, {'total_detections':1}):
            with patch('sam3_deployed.post_json', return_value={**base, **changes}):
                with self.assertRaises(ServiceError):
                    recognize(Image.new('RGB',(120,100)), '', 'car', [], .35)

    def test_no_detection_or_change_is_explicit_empty_result(self):
        if MODE == 'detect':
            result = sam_segment(Image.new('RGB', (120, 100)), prompt='nothing')
            self.assertEqual(result, [])
        else:
            options = validate_options({'align': False})
            parts, *_ = change_candidates(Image.open(io.BytesIO(png())), Image.open(io.BytesIO(png())), options)
            self.assertEqual(parts, [])

    def test_unalignable_pair_is_rejected(self):
        if MODE != 'change':
            self.skipTest('change-only registration')
        components, aligned, valid, matrix = change_candidates(
            Image.new('RGB', (120, 100), 'white'),
            Image.new('RGB', (120, 100), 'white'), validate_options({}))
        self.assertEqual(aligned.size, (120, 100))
        self.assertEqual(valid.shape, (100, 120))
        self.assertEqual(len(matrix), 3)

    def test_replace_delete(self):
        self.login()
        status,raw=self.upload()
        self.assertEqual(status,201,raw)
        first=json.loads(raw)['id'];self.wait(first)
        status,raw=self.request('/api/tasks',{'tool':MODE,'replace_id':first,'files':[], 'options':{'taskName':'重跑任务','target':'car','align':False,'score':.6}})
        self.assertEqual(status,201,raw)
        second=json.loads(raw)['id'];task=self.wait(second)
        self.assertEqual(task['options']['score'],.6)
        self.assertIn('objects.csv',task['outputs'])
        self.assertEqual(len(self.app.store.list('1')),1)
        other=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.request('/api/session',{'ticket':'b'*64},other)
        self.assertEqual(self.request(f'/api/tasks/{second}/delete',{},other)[0],404)
        self.assertEqual(self.request(f'/api/tasks/{second}/delete',{})[0],200)
        self.assertEqual(self.app.store.list('1'),[])
        self.assertFalse((self.app.store.root/second).exists())


if __name__ == "__main__":
    unittest.main()
