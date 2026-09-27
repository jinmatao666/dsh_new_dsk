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
                self.assertEqual(self.request("/api/tasks")[0], 401)

    def test_expired_and_forged_sessions_cannot_read_or_submit_tasks(self):
        self.identity = {"user_id": "123"}
        status, _, headers = self.request("/api/session", {"ticket": "a" * 64})
        self.assertEqual(status, 200)
        name, morsel = next(iter(SimpleCookie(headers["Set-Cookie"]).items()))
        valid = f"{name}={morsel.value}"
        self.assertEqual(self.request("/api/tasks", cookie=valid)[0], 200)
        with self.server.store.connect() as database:
            database.execute("UPDATE sessions SET expires=0")
        forged = f"{name}={'0' * 64}"
        for cookie in (valid, forged):
            with self.subTest(cookie_kind="expired" if cookie == valid else "forged"):
                self.assertEqual(self.request("/api/tasks", cookie=cookie)[0], 401)
                self.assertEqual(self.request("/api/tasks", body={}, cookie=cookie)[0], 401)
        # Re-entering through a fresh platform exchange restores access without reviving the old cookie.
        status, _, headers = self.request("/api/session", {"ticket": "b" * 64})
        self.assertEqual(status, 200)
        new_name, new_cookie = next(iter(SimpleCookie(headers["Set-Cookie"]).items()))
        self.assertNotEqual(new_cookie.value, morsel.value)
        self.assertEqual(self.request("/api/tasks", cookie=f"{new_name}={new_cookie.value}")[0], 200)
        self.assertEqual(self.request("/api/tasks", cookie=valid)[0], 401)

    def test_valid_identity_exposes_only_user_and_secures_cookie(self):
        self.identity = {"user_id": "123", "provider_secret": "must-not-leak"}
        status, body, headers = self.request("/api/session", {"ticket": "a" * 64})
        self.assertEqual(status, 200)
        self.assertEqual(body, {"user_id": "123"})
        cookie = SimpleCookie(headers["Set-Cookie"])
        self.assertEqual(len(cookie), 1)
        name, morsel = next(iter(cookie.items()))
        self.assertTrue(morsel["httponly"])
        self.assertTrue(morsel["secure"])
        self.assertEqual(morsel["samesite"], "Strict")
        self.assertEqual(self.request("/api/tasks", cookie=f"{name}={morsel.value}")[:2],
                         (200, {"items": []}))


if __name__ == "__main__":
    unittest.main()
