import base64
from http.cookies import SimpleCookie
import json
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
        self.assertTrue(cookie["expert_coordinate_transform_session"]["secure"])
        return "expert_coordinate_transform_session=" + cookie["expert_coordinate_transform_session"].value

    def test_authentication_origin_and_static_headers(self):
        self.assertEqual(self.request("/api/tasks")[0], 401)
        self.assertEqual(self.request("/api/session", {"ticket": "a" * 64}, origin="https://evil.test")[0], 403)
        status, data, headers = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("<title>坐标转换</title>".encode(), data)
        self.assertIn("<strong>坐标转换</strong>".encode(), data)
        self.assertIn("frame-src 'none'", headers["Content-Security-Policy"])

    def test_coordinate_task_download_and_user_isolation(self):
        cookie_a, cookie_b = self.login("a"), self.login("b")
        payload = "id,x,y\n1,120.15,30.28\n".encode()
        status, data, _ = self.request("/api/tasks", {
            "tool": "coordinate-transform",
            "options": {"method": "epsg", "sourceEpsg": "4326", "targetEpsg": "4547", "xField": "x", "yField": "y"},
            "files": [{"name": "points.csv", "content": base64.b64encode(payload).decode()}],
        }, cookie_a)
        self.assertEqual(status, 201)
        task_id = json.loads(data)["id"]
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            items = json.loads(self.request("/api/tasks", cookie=cookie_a)[1])["items"]
            if items[0]["state"] not in ("queued", "running"):
                break
            time.sleep(.1)
        self.assertEqual(items[0]["state"], "succeeded", items[0])
        self.assertNotIn("user_id", items[0])
        self.assertEqual(json.loads(self.request("/api/tasks", cookie=cookie_b)[1])["items"], [])
        self.assertEqual(self.request(f"/api/tasks/{task_id}/files/0", cookie=cookie_b)[0], 404)
        status, body, _ = self.request(f"/api/tasks/{task_id}/files/0", cookie=cookie_a)
        self.assertEqual(status, 200)
        self.assertIn(b"x_out", body)

    def test_path_traversal_upload_rejected(self):
        cookie = self.login("a")
        status, _, _ = self.request("/api/tasks", {
            "tool": "coordinate-transform",
            "options": {"method": "epsg", "sourceEpsg": "4326", "targetEpsg": "4547"},
            "files": [{"name": "../x.csv", "content": base64.b64encode(b"x,y\n1,2\n").decode()}],
        }, cookie)
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
