import base64
from http.cookies import SimpleCookie
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

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
        self.assertTrue(cookie["expert_gis_format_converter_session"]["secure"])
        return "expert_gis_format_converter_session=" + cookie["expert_gis_format_converter_session"].value

    def test_authentication_origin_and_static_headers(self):
        self.assertEqual(self.request("/api/tasks")[0], 401)
        self.assertEqual(self.request("/api/session", {"ticket": "a" * 64}, origin="https://evil.test")[0], 403)
        status, data, headers = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("<title>GIS 格式转换</title>".encode(), data)
        self.assertIn("<strong>GIS 格式转换</strong>".encode(), data)
        self.assertIn("frame-src 'none'", headers["Content-Security-Policy"])

    def test_rejects_unknown_tool(self):
        cookie = self.login("a")
        status, _, _ = self.request("/api/tasks", {
            "tool": "coordinate-transform",
            "options": {},
            "files": [{"name": "points.csv", "content": "AAAA"}],
        }, cookie)
        self.assertEqual(status, 400)

    def test_session_cookie_name(self):
        cookie = self.login("a")
        self.assertTrue(cookie.startswith("expert_gis_format_converter_session="))


    def test_path_traversal_upload_rejected(self):
        cookie = self.login("a")
        status, _, _ = self.request("/api/tasks", {
            "tool": "format-convert",
            "options": {"targetFormat": "shp"},
            "files": [{"name": "../x.zip", "content": base64.b64encode(b"PK").decode()}],
        }, cookie)
        self.assertEqual(status, 400)

    def test_delete_terminal_task_and_ownership(self):
        cookie_a, cookie_b = self.login("a"), self.login("b")
        task_id = "c" * 32
        directory = Path(self.temp.name) / task_id
        directory.mkdir()
        (directory / "marker.txt").write_text("x", encoding="utf-8")
        self.server.store.create("a", "format-convert", {}, ["a.zip"], task_id)
        status, data, _ = self.request(f"/api/tasks/{task_id}/delete", {}, cookie_a)
        self.assertEqual(status, 400)
        self.assertIn("取消", json.loads(data)["error"])
        self.server.store.claim(task_id)
        self.server.store.finish(task_id, error="failed")
        self.assertEqual(self.request(f"/api/tasks/{task_id}/delete", {}, cookie_b)[0], 404)
        status, data, _ = self.request(f"/api/tasks/{task_id}/delete", {}, cookie_a)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(data)["deleted"])
        self.assertEqual(json.loads(self.request("/api/tasks", cookie=cookie_a)[1])["items"], [])
        self.assertFalse(directory.exists())


if __name__ == "__main__":
    unittest.main()
