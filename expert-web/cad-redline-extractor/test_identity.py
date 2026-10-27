"""HTTP identity boundary tests; platform replies are explicit test doubles."""
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.cookies import SimpleCookie

from server import create_server


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.identity = None
        self.server = create_server(self.temp.name, ("127.0.0.1", 0),
                                    redeem_ticket=lambda ticket: self.identity,
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

    def request(self, path, body=None, cookie=None):
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        request = urllib.request.Request(self.url + path,
                                         data=json.dumps(body).encode() if body is not None else None,
                                         headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers

    def test_malformed_platform_identity_never_creates_session(self):
        invalid = (None, [], "secret", 123, True, {}, {"user_id": None},
                   {"user_id": 123}, {"user_id": ""}, {"user_id": "a" * 181})
        for identity in invalid:
            with self.subTest(identity=identity):
                self.identity = identity
                status, body, headers = self.request("/api/session", {"ticket": "a" * 64})
                self.assertEqual(status, 401)
                self.assertEqual(body, {"error": "登录身份无效"})
                self.assertIsNone(headers.get("Set-Cookie"))

    def test_valid_identity_exposes_only_user_and_secures_cookie(self):
        self.identity = {"user_id": "123", "provider_secret": "must-not-leak"}
        status, body, headers = self.request("/api/session", {"ticket": "a" * 64})
        self.assertEqual(status, 200)
        self.assertEqual(body, {"user_id": "123"})
        self.assertNotIn("provider_secret", json.dumps(body))
        cookie = SimpleCookie(headers["Set-Cookie"])["expert_cad_redline_extractor_session"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Strict")
        self.assertTrue(cookie["secure"])


if __name__ == "__main__":
    unittest.main()
