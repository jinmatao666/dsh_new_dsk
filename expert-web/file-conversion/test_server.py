import base64
from http.cookies import SimpleCookie
import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pypdf import PdfWriter, PdfReader
from PIL import Image
from server import create_server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = create_server(self.temp.name, ("127.0.0.1", 0),
                                    redeem_ticket=lambda ticket: {"user_id": "a" if ticket[0] == "a" else "b"},
                                    public_url="https://expert.test")
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.server.worker.close()
        self.temp.cleanup()

    def request(self, path, body=None, cookie=None, origin=None):
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        if origin:
            headers["Origin"] = origin
        request = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None,
                                         headers=headers)
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as response:
            return response.code, response.read(), response.headers

    def login(self, letter):
        status, _, headers = self.request("/api/session", {"ticket": letter * 64})
        self.assertEqual(status, 200)
        cookie = SimpleCookie(headers["Set-Cookie"])
        self.assertTrue(cookie["expert_conversion_session"]["secure"])
        return "expert_conversion_session=" + cookie["expert_conversion_session"].value

    def test_authentication_origin_and_static_headers(self):
        self.assertEqual(self.request("/api/tasks")[0], 401)
        self.assertEqual(self.request("/api/session", {"ticket": "a" * 64}, origin="https://evil.test")[0], 403)
        status, data, headers = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("文件转换".encode(), data)
        self.assertIn("frame-src 'none'", headers["Content-Security-Policy"])

    def test_upload_path_names_rejected(self):
        cookie = self.login("a")
        tool = "pdf-images"
        name = "../test.pdf"
        status, _, _ = self.request("/api/tasks", {"tool": tool, "options": {}, "files": [
            {"name": name, "content": base64.b64encode(b"dummy").decode()}]}, cookie)
        self.assertEqual(status, 400)

    def test_real_task_download_and_user_isolation(self):
        cookie_a, cookie_b = self.login("a"), self.login("b")
        source = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        writer.write(source)
        writer.close()
        status, data, _ = self.request("/api/tasks", {"tool": "pdf-organize", "options": {"mode": "pages"},
                                      "files": [{"name": "test.pdf", "content": base64.b64encode(source.getvalue()).decode()}]}, cookie_a)
        self.assertEqual(status, 201)
        task_id = json.loads(data)["id"]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            items = json.loads(self.request("/api/tasks", cookie=cookie_a)[1])["items"]
            if items[0]["state"] not in ("queued", "running"):
                break
            time.sleep(.1)
        self.assertEqual(items[0]["state"], "succeeded")
        self.assertNotIn("user_id", items[0])
        self.assertEqual(json.loads(self.request("/api/tasks", cookie=cookie_b)[1])["items"], [])
        self.assertEqual(self.request(f"/api/tasks/{task_id}/files/0", cookie=cookie_b)[0], 404)
        status, pdf, _ = self.request(f"/api/tasks/{task_id}/files/0", cookie=cookie_a)
        self.assertEqual(status, 200)
        self.assertEqual(len(PdfReader(io.BytesIO(pdf)).pages), 1)

    def test_all_local_conversion_routes_publish_readable_downloads(self):
        cookie = self.login("a")
        pdf_source = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        writer.write(pdf_source)
        writer.close()
        image_source = io.BytesIO()
        Image.new("RGB", (120, 60), (24, 96, 180)).save(image_source, format="PNG")
        cases = [
            ("pdf-images", "source.pdf", pdf_source.getvalue(), {"dpi": 144}, "image", (144, 144)),
            ("images-pdf", "source.png", image_source.getvalue(), {}, "pdf", 1),
            ("image-optimize", "source.png", image_source.getvalue(), {"format": "png", "maxWidth": 60}, "image", (60, 30)),
            ("pdf-organize", "source.pdf", pdf_source.getvalue(), {"mode": "pages"}, "pdf", 1),
        ]
        for tool, name, source, options, output_type, expected in cases:
            with self.subTest(tool=tool):
                status, data, _ = self.request("/api/tasks", {"tool": tool, "options": options,
                    "files": [{"name": name, "content": base64.b64encode(source).decode()}]}, cookie)
                self.assertEqual(status, 201, data)
                task_id = json.loads(data)["id"]
                deadline = time.monotonic() + 20
                task = None
                while time.monotonic() < deadline:
                    items = json.loads(self.request("/api/tasks", cookie=cookie)[1])["items"]
                    task = next(item for item in items if item["id"] == task_id)
                    if task["state"] not in ("queued", "running"):
                        break
                    time.sleep(.1)
                self.assertEqual(task["state"], "succeeded", task)
                self.assertEqual(len(task["outputs"]), 1)
                status, result, headers = self.request(f"/api/tasks/{task_id}/files/0", cookie=cookie)
                self.assertEqual(status, 200)
                self.assertIn("attachment", headers["Content-Disposition"])
                if output_type == "pdf":
                    self.assertEqual(len(PdfReader(io.BytesIO(result)).pages), expected)
                else:
                    with Image.open(io.BytesIO(result)) as image:
                        image.load()
                        self.assertEqual(image.size, expected)

    def test_reject_wrong_type_and_invalid_upload(self):
        cookie = self.login("a")
        self.assertEqual(self.request("/api/tasks", {"tool": "pdf-images", "files": [{"name": "a.exe", "content": "AAAA"}]}, cookie)[0], 400)
        self.assertEqual(self.request("/api/tasks", {"tool": "pdf-images", "files": [{"name": "a.pdf", "content": "not-base64"}]}, cookie)[0], 400)


if __name__ == "__main__":
    unittest.main()
