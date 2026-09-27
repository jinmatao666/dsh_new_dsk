import base64
from http.cookies import SimpleCookie
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from docx import Document
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
        self.assertTrue(cookie["expert_meeting_session"]["secure"])
        return "expert_meeting_session=" + cookie["expert_meeting_session"].value

    def test_authentication_origin_and_static_headers(self):
        self.assertEqual(self.request("/api/tasks")[0], 401)
        self.assertEqual(self.request("/api/session", {"ticket": "a" * 64}, origin="https://evil.test")[0], 403)
        status, data, headers = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("会议纪要".encode(), data)
        self.assertIn("frame-src 'none'", headers["Content-Security-Policy"])

    def test_upload_path_names_rejected(self):
        cookie = self.login("a")
        tool = "minutes"
        name = "../old.txt"
        status, _, _ = self.request("/api/tasks", {"tool": tool, "options": {}, "files": [
            {"name": name, "content": base64.b64encode(b"dummy").decode()}]}, cookie)
        self.assertEqual(status, 400)

    def test_unconfigured_model_fails_and_user_isolation(self):
        cookie_a, cookie_b = self.login("a"), self.login("b")
        status, data, _ = self.request("/api/tasks", {"tool": "minutes", "options": {},
                                      "files": [{"name": "old.txt", "content": base64.b64encode("原文".encode()).decode()},
                                                {"name": "new.txt", "content": base64.b64encode("新文".encode()).decode()}]}, cookie_a)
        self.assertEqual(status, 201)
        task_id = json.loads(data)["id"]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            items = json.loads(self.request("/api/tasks", cookie=cookie_a)[1])["items"]
            if items[0]["state"] not in ("queued", "running"):
                break
            time.sleep(.1)
        self.assertEqual(items[0]["state"], "failed")
        self.assertIn("尚未配置", items[0]["error"])
        self.assertNotIn("user_id", items[0])
        self.assertEqual(json.loads(self.request("/api/tasks", cookie=cookie_b)[1])["items"], [])
        self.assertEqual(self.request(f"/api/tasks/{task_id}/files/0", cookie=cookie_b)[0], 404)
        self.assertEqual(self.request(f"/api/tasks/{task_id}/files/0", cookie=cookie_a)[0], 404)

    def test_reject_wrong_type_and_invalid_upload(self):
        cookie = self.login("a")
        self.assertEqual(self.request("/api/tasks", {"tool": "compare", "files": [{"name": "a.exe", "content": "AAAA"}]}, cookie)[0], 400)
        self.assertEqual(self.request("/api/tasks", {"tool": "compare", "files": [{"name": "a.pdf", "content": "not-base64"}]}, cookie)[0], 400)
        audio = base64.b64encode(b"audio").decode()
        status, _, _ = self.request("/api/tasks", {"tool": "minutes", "files": [
            {"name": "first.wav", "content": audio}, {"name": "second.m4a", "content": audio}]}, cookie)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(self.request("/api/tasks", cookie=cookie)[1])["items"], [])

    def test_summary_belongs_to_task_owner_and_not_deliverables(self):
        owner, other = self.login("a"), self.login("b")
        task_id = "c" * 32
        self.server.store.create("a", "minutes", {"title": "项目会"}, ["000.txt"], task_id)
        self.assertTrue(self.server.store.claim(task_id))
        self.server.store.finish(task_id, outputs=["会议纪要.docx"])
        Path(self.temp.name, task_id).mkdir()
        Path(self.temp.name, task_id, "summary.md").write_text("真实执行摘要", encoding="utf-8")
        self.assertEqual(self.request(f"/api/tasks/{task_id}/summary", cookie=other)[0], 404)
        status, data, _ = self.request(f"/api/tasks/{task_id}/summary", cookie=owner)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data), {"text": "真实执行摘要", "truncated": False})
        item = json.loads(self.request("/api/tasks", cookie=owner)[1])["items"][0]
        self.assertEqual(item["outputs"], ["会议纪要.docx"])
        self.assertNotIn("summary", item)
        Path(self.temp.name, task_id, "summary.md").write_text("中" * 22000, encoding="utf-8")
        status, data, _ = self.request(f"/api/tasks/{task_id}/summary", cookie=owner)
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(data)["text"]), 20000)
        self.assertTrue(json.loads(data)["truncated"])

    def test_http_cancel_stops_only_owned_running_task(self):
        owner, other = self.login("a"), self.login("b")
        task_id = "d" * 32
        self.server.store.create("a", "minutes", {}, ["000.txt"], task_id)
        self.assertTrue(self.server.store.claim(task_id))
        with patch.object(self.server.worker, "cancel") as stop:
            self.assertEqual(self.request(f"/api/tasks/{task_id}/cancel", {}, other)[0], 404)
            self.assertEqual(self.request(f"/api/tasks/{task_id}/cancel", {}, owner)[0], 200)
            stop.assert_called_once_with(task_id)
        self.assertEqual(self.server.store.task("a", task_id)["state"], "cancelled")


if __name__ == "__main__":
    unittest.main()
