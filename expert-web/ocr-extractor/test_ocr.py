"""Local image and provider fixtures; never call a real model or production platform."""
import base64
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from PIL import Image
from deployment import model_configuration
from ocr import inspect_image, normalize_output, validate_options, OCRError
from server import create_server


def png():
    out = io.BytesIO()
    Image.new("RGB", (80, 60), "white").save(out, "PNG")
    return out.getvalue()


class ValidationTests(unittest.TestCase):
    def test_real_image_and_corrupt_data(self):
        self.assertEqual(inspect_image(png())["width"], 80)
        for data in (b"", b"not an image", b"\x89PNG\r\n\x1a\n"):
            with self.assertRaises(OCRError): inspect_image(data)

    def test_pixel_limit(self):
        with patch("ocr.MAX_PIXELS", 10):
            with self.assertRaises(OCRError): inspect_image(png())

    def test_custom_requires_instruction(self):
        for options in ({"mode": "custom"}, {"format": "exe"}, {"instruction": "x" * 2001}, {"mode": "unknown"}):
            with self.assertRaises(OCRError): validate_options(options)
        self.assertEqual(validate_options({"mode": "custom", "instruction": " 项目名称 "})["instruction"], "项目名称")

    def test_json_is_validated(self):
        self.assertIn('"项目"', normalize_output('```json\n{"项目":null}\n```', "json"))
        for text in ("Not JSON", "NaN", "123", "{\"x\":NaN}"):
            with self.assertRaises(OCRError): normalize_output(text, "json")

    def test_csv_is_rectangular_and_formula_safe(self):
        self.assertIn("'=1+1", normalize_output("字段,值\n项目,=1+1", "csv"))
        with self.assertRaises(OCRError): normalize_output("a,b\n1,2,3", "csv")

    def test_invalid_model_urls_do_not_crash_or_enable_redirect_credentials(self):
        for endpoint in ("http://[bad", "file:///tmp/model", "https://user:secret@host.test/v1/chat/completions", "http://remote.test/api"):
            with patch.dict(os.environ, {"EXPERT_MODEL_URL": endpoint, "EXPERT_MODEL": "vision", "EXPERT_MODEL_KEY": "fixture", "EXPERT_ALLOW_HTTP_MODEL": "0"}):
                self.assertFalse(model_configuration())


class Provider(BaseHTTPRequestHandler):
    response_mode = "text"
    calls = []
    def log_message(self, *args): pass
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Provider.calls.append(payload)
        text = '{"项目名称":"fixture"}' if Provider.response_mode == "json" else "fixture OCR content"
        value = {"choices": [{"finish_reason": "length" if Provider.response_mode == "truncated" else "stop", "message": {"content": text}}]}
        if self.path == '/ocr':
            value = {'errorCode': 0, 'result': {'ocrResults': [{'prunedResult': {
                'rec_texts': ['fixture OCR content'], 'rec_scores': [0.99],
                'rec_polys': [[[0, 0], [60, 0], [60, 20], [0, 20]]]
            }}]}}
            if Provider.response_mode == 'bad_paddle':
                value['result']['ocrResults'][0]['prunedResult']['rec_scores'] = []
        data = json.dumps(value).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        Provider.response_mode = "text"; Provider.calls = []
        self.model = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        self.model_thread = threading.Thread(target=self.model.serve_forever, daemon=True); self.model_thread.start()
        self.env = patch.dict(os.environ, {"EXPERT_MODEL_URL": f"http://127.0.0.1:{self.model.server_port}/v1/chat/completions", "EXPERT_MODEL": "fixture-vision", "EXPERT_MODEL_KEY": "", "EXPERT_PUBLIC_URL": "http://platform.test", "EXPERT_PLATFORM_REDEEM_URL": "http://platform.test/api/expert-web/redeem", "EXPERT_PROVIDER_CREDENTIAL": "fixture-only"})
        self.env.start()
        os.environ['PADDLEOCR_URL'] = f'http://127.0.0.1:{self.model.server_port}/ocr'
        self.tmp = tempfile.TemporaryDirectory()
        self.consumed = set()
        def redeem(ticket):
            if ticket in self.consumed or ticket not in ("a"*64, "b"*64): raise ValueError("invalid fixture")
            self.consumed.add(ticket)
            return {"user_id": "1" if ticket[0] == "a" else "2"}
        self.app = create_server(self.tmp.name, ("127.0.0.1", 0), redeem_ticket=redeem, public_url="http://platform.test")
        self.app_thread = threading.Thread(target=self.app.serve_forever, daemon=True); self.app_thread.start()
        self.base = f"http://127.0.0.1:{self.app.server_port}"
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.reporter = patch("server.report_usage"); self.reporter.start()

    def tearDown(self):
        self.app.shutdown(); self.app.server_close(); self.app.worker.close(); self.app_thread.join()
        self.model.shutdown(); self.model.server_close(); self.model_thread.join()
        self.reporter.stop(); self.env.stop(); self.tmp.cleanup()

    def request(self, path, body=None, client=None, origin="http://platform.test"):
        headers = {"Origin": origin}
        if body is not None: headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with (client or self.client).open(req, timeout=5) as response: return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error: return error.code, error.read(), error.headers

    def login(self, ticket="a"*64, client=None):
        self.assertEqual(self.request("/api/session", {"ticket": ticket}, client=client)[0], 200)

    def upload(self, options=None, name="scan.png", data=None):
        return self.request("/api/tasks", {"tool": "ocr", "options": options or {}, "files": [{"name": name, "content": base64.b64encode(png() if data is None else data).decode()}]})

    def wait(self, task_id):
        import time
        until = time.monotonic() + 12
        while time.monotonic() < until:
            task = self.app.store.task("1", task_id)
            if task["state"] not in ("queued", "running"): return task
            time.sleep(.05)
        self.fail("worker did not finish")

    def test_static_page_csp_and_auth_required(self):
        status, content, headers = self.request("/")
        self.assertEqual(status, 200); self.assertIn("OCR识别专家".encode(), content)
        self.assertIn("frame-src 'none'", headers["Content-Security-Policy"])
        self.assertEqual(self.request("/api/tasks")[0], 401)
        self.assertEqual(self.request("/assets/sample-form.svg")[0], 200)
        self.assertEqual(self.request("/api/not-found")[0], 401)

    def test_ticket_cookie_replay_and_origin(self):
        status, _, headers = self.request("/api/session", {"ticket": "a"*64})
        self.assertEqual(status, 200)
        self.assertIn("expert_ocr_extractor_session=", headers["Set-Cookie"])
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertEqual(self.request("/api/session", {"ticket": "a"*64})[0], 401)
        self.assertEqual(self.request("/api/session", {"ticket": "b"*64}, origin="https://evil.test")[0], 403)

    def test_unconfigured_model_returns_503_without_a_task(self):
        self.login()
        with patch.dict(os.environ, {"PADDLEOCR_URL": ""}):
            self.assertEqual(self.upload()[0], 503)
            self.assertEqual(self.app.store.list("1"), [])

    def test_bad_uploads_and_invalid_options(self):
        self.login()
        for name, data, options in (("../scan.png", png(), {}), ("scan.jpg", png(), {}), ("scan.png", b"bad", {}), ("scan.png", png(), {"mode": "custom"})):
            self.assertEqual(self.upload(options, name, data)[0], 400)
        self.assertFalse(Provider.calls)

    def test_full_real_http_worker_download_and_user_isolation(self):
        self.login()
        status, body, _ = self.upload()
        self.assertEqual(status, 201)
        task_id = json.loads(body)["id"]
        task = self.wait(task_id)
        self.assertEqual(task["state"], "succeeded", task)
        self.assertEqual(self.request(f"/api/tasks/{task_id}/files/0")[1], b"fixture OCR content")
        self.assertEqual(self.request(f"/api/tasks/{task_id}/image")[1], png())
        self.assertEqual(json.loads(self.request(f"/api/tasks/{task_id}/result")[1])["format"], "text")
        self.assertEqual(Provider.calls[0]['fileType'], 1)
        self.assertEqual(Image.open(io.BytesIO(base64.b64decode(Provider.calls[0]['file']))).format, 'PNG')
        other = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.login("b"*64, other)
        self.assertEqual(json.loads(self.request("/api/tasks", client=other)[1])["items"], [])
        for path in ("image", "result", "files/0"):
            self.assertEqual(self.request(f"/api/tasks/{task_id}/{path}", client=other)[0], 404)
        self.assertEqual(self.request(f"/api/tasks/{task_id}/cancel", {}, client=other)[0], 404)

    def test_custom_json_and_truncated_response(self):
        self.login(); Provider.response_mode = "json"
        body = self.upload({"format": "json", "mode": "custom", "instruction": "项目名称"})[1]
        task = self.wait(json.loads(body)["id"])
        self.assertEqual(task["state"], "succeeded", task)
        self.assertEqual(task["outputs"], ["识别结果.json", "OCR原始识别.json", "OCR原文.txt"])
        self.assertTrue(all(isinstance(m['content'], str) for m in Provider.calls[-1]['messages']))
        Provider.response_mode = "truncated"
        body = self.upload({'mode': 'custom', 'instruction': '提取内容'})[1]; task = self.wait(json.loads(body)["id"])
        self.assertEqual(task["state"], "failed"); self.assertEqual(task["outputs"], [])

    def test_restart_preserves_completed_record_but_interrupts_active(self):
        from store import Store
        self.login()
        task_id = json.loads(self.upload()[1])["id"]
        self.assertEqual(self.wait(task_id)["state"], "succeeded")
        separate = Store(self.tmp.name)
        self.assertEqual(separate.task("1", task_id)["state"], "succeeded")

    def test_full_ocr_does_not_require_or_call_qwen(self):
        self.login()
        with patch.dict(os.environ, {'EXPERT_MODEL_URL': '', 'EXPERT_MODEL': ''}):
            task = self.wait(json.loads(self.upload()[1])['id'])
        self.assertEqual(task['state'], 'succeeded')
        self.assertTrue(all('messages' not in call for call in Provider.calls))
        self.assertIn('OCR原始识别.json', task['outputs'])

    def test_bad_paddle_arrays_fail_without_results(self):
        self.login()
        Provider.response_mode = 'bad_paddle'
        task = self.wait(json.loads(self.upload()[1])['id'])
        self.assertEqual(task['state'], 'failed')
        self.assertEqual(task['outputs'], [])

    def test_missing_formatter_fails_custom_without_inventing_fields(self):
        self.login()
        with patch.dict(os.environ, {'EXPERT_MODEL_URL': '', 'EXPERT_MODEL': ''}):
            task = self.wait(json.loads(self.upload({'mode': 'custom', 'instruction': '项目名称'})[1])['id'])
        self.assertEqual(task['state'], 'failed')
        self.assertEqual(task['outputs'], [])

    def test_cancelled_task_never_exposes_outputs(self):
        self.login()
        with patch.object(self.app.worker, "submit"):
            task_id = json.loads(self.upload()[1])["id"]
        self.assertEqual(self.request(f"/api/tasks/{task_id}/cancel", {})[0], 200)
        self.assertEqual(self.app.store.task("1", task_id)["state"], "cancelled")
        self.assertEqual(self.request(f"/api/tasks/{task_id}/files/0")[0], 404)


if __name__ == "__main__": unittest.main()
