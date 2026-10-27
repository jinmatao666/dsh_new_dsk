"""Exercise the HTTP adapter without importing Torch or loading SAM3 weights."""
import base64
import io
import json
import threading
import unittest
import urllib.request
import urllib.error
from PIL import Image
from sam3_http import create_server, validate


def payload():
    data = io.BytesIO()
    Image.new('RGB', (40, 30), 'white').save(data, 'PNG')
    return {'schema_version': 1, 'image': base64.b64encode(data.getvalue()).decode(),
            'text': 'car', 'boxes': [], 'return_masks': False, 'score_threshold': .35}


class AdapterTests(unittest.TestCase):
    def test_invalid_prompts_sizes_and_nonfinite_values(self):
        for change in ({'schema_version': 2}, {'text': '', 'boxes': []},
                       {'boxes': [[.1, .1, .8, .8]]}, {'score_threshold': float('nan')},
                       {'image': 'not-base64'}, {'return_masks': 'true'}):
            with self.assertRaises((ValueError, TypeError)):
                validate({**payload(), **change})

    def test_box_prompt_accepts_normalized_xyxy(self):
        image, text, boxes, precise, _ = validate({**payload(), 'text': '', 'boxes': [[.1, .1, .9, .9]]})
        self.assertEqual(image.size, (40, 30))
        self.assertEqual(text, '')
        self.assertEqual(boxes[0], [.1, .1, .9, .9])

    def test_http_authentication_schema_and_concurrent_rejection(self):
        entered, release = threading.Event(), threading.Event()
        def predict(*args):
            entered.set()
            release.wait(5)
            return []
        app = create_server(predict, ('127.0.0.1', 0), 'fixture-service-secret')
        thread = threading.Thread(target=app.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{app.server_port}'
        def call(auth='Bearer fixture-service-secret'):
            req = urllib.request.Request(base + '/segment', data=json.dumps(payload()).encode(),
                headers={'Content-Type': 'application/json', 'Authorization': auth})
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=8) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, None
        try:
            self.assertEqual(call('Bearer wrong')[0], 401)
            output = []
            first = threading.Thread(target=lambda: output.append(call()))
            first.start()
            self.assertTrue(entered.wait(3))
            self.assertEqual(call()[0], 503)
            release.set(); first.join(5)
            self.assertEqual(output[0][0], 200)
            self.assertEqual(output[0][1]['schema_version'], 1)
            self.assertEqual(output[0][1]['objects'], [])
        finally:
            release.set(); app.shutdown(); app.server_close()


if __name__ == '__main__':
    unittest.main()
