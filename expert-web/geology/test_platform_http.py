"""The configured HTTP platform receives the ticket; redirects remain rejected."""
import json
import os
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from server import redeem
from deployment import checks


class PlatformHTTPTests(unittest.TestCase):
    def test_http_redemption_and_redirect_rejection(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                received.append((self.path, self.headers.get("Authorization"), json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/redeem")
                else:
                    self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"user_id":"test-user"}')

        service = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=service.serve_forever)
        thread.start()
        try:
            endpoint = f"http://127.0.0.1:{service.server_port}"
            with patch.dict(os.environ, {"EXPERT_PLATFORM_REDEEM_URL": endpoint + "/redeem", "EXPERT_PROVIDER_CREDENTIAL": "test-only", "EXPERT_PUBLIC_URL": "http://ac.zjugis.com:3301"}, clear=True):
                self.assertTrue(checks()["public_origin"])
                self.assertTrue(checks()["identity_endpoint"])
                self.assertEqual(redeem("test-ticket"), {"user_id": "test-user"})
                os.environ["EXPERT_PLATFORM_REDEEM_URL"] = endpoint + "/redirect"
                with self.assertRaises(urllib.error.HTTPError):
                    redeem("test-ticket")
            self.assertEqual(len(received), 2)
            self.assertEqual(received[0], ("/redeem", "Bearer test-only", {"ticket": "test-ticket"}))
        finally:
            service.shutdown()
            thread.join()
            service.server_close()
