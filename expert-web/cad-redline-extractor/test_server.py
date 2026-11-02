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
        self.assertTrue(cookie["expert_cad_redline_extractor_session"]["secure"])
        return "expert_cad_redline_extractor_session=" + cookie["expert_cad_redline_extractor_session"].value

    def test_authentication_origin_and_static_headers(self):
        self.assertEqual(self.request("/api/tasks")[0], 401)
        self.assertEqual(self.request("/api/session", {"ticket": "a" * 64}, origin="https://evil.test")[0], 403)
        status, data, headers = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("<title>红线提取</title>".encode(), data)
        self.assertIn("<strong>红线提取</strong>".encode(), data)
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
        self.assertTrue(cookie.startswith("expert_cad_redline_extractor_session="))

    def test_map_config_and_overlay_parse(self):
        cookie = self.login("a")
        status, data, _ = self.request("/api/map-config", cookie=cookie)
        self.assertEqual(status, 200)
        payload = json.loads(data)
        self.assertTrue(payload["onlineEnabled"])
        self.assertTrue(payload["proxy"])
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {"id": 1},
                "geometry": {"type": "Point", "coordinates": [120.1, 30.2]},
            }],
        }
        status, data, _ = self.request("/api/overlay/parse", {
            "files": [{"name": "point.geojson", "content": base64.b64encode(json.dumps(geojson).encode()).decode()}],
        }, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["count"], 1)
        self.assertEqual(self.request("/api/overlay/parse", {"files": []}, cookie)[0], 400)
        status, data, _ = self.request("/api/overlay/online-map", {
            "serviceUrl": "http://127.0.0.1/wms",
            "layerName": "demo",
            "bbox": [1, 2, 3, 4],
            "width": 256,
            "height": 256,
            "crs": "EPSG:4326",
        }, cookie)
        self.assertEqual(status, 400)
        self.assertIn("内网", json.loads(data)["error"])
        status, data, _ = self.request("/api/overlay/arcgis-token", {
            "serviceUrl": "http://127.0.0.1/arcgis/rest/services/x/MapServer",
            "username": "u",
            "password": "p",
        }, cookie)
        self.assertEqual(status, 400)
        self.assertIn("内网", json.loads(data)["error"])
        status, data, _ = self.request("/api/overlay/arcgis-info", {
            "serviceUrl": "http://127.0.0.1/arcgis/rest/services/x/MapServer",
            "token": "t",
        }, cookie)
        self.assertEqual(status, 400)
        self.assertIn("内网", json.loads(data)["error"])
        self.assertNotEqual(json.loads(data).get("error"), "接口不存在")


    def test_path_traversal_upload_rejected(self):
        cookie = self.login("a")
        status, _, _ = self.request("/api/tasks", {
            "tool": "redline-extract",
            "options": {"exportFormat": "geojson"},
            "files": [{"name": "../x.dxf", "content": base64.b64encode(b"0\nSECTION\n").decode()}],
        }, cookie)
        self.assertEqual(status, 400)

    def test_delete_terminal_task_and_ownership(self):
        cookie_a, cookie_b = self.login("a"), self.login("b")
        task_id = "c" * 32
        directory = Path(self.temp.name) / task_id
        directory.mkdir()
        (directory / "marker.txt").write_text("x", encoding="utf-8")
        self.server.store.create("a", "redline-extract", {}, ["a.dxf"], task_id)
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
