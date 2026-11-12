"""Keyless per-feature SDK contract checks against a local HTTP server."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
import unittest
import json
from business_billing import Billing, BillingError

class TestBillingSDK(unittest.TestCase):
    def setUp(self):
        self.calls = []
        calls = self.calls
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                calls.append((self.path, self.headers.get("Authorization"), None))
                self.reply({"success": True, "data": {"rule": {"version": 5}}})
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append((self.path, self.headers.get("Authorization"), body))
                if self.path.endswith("/result"):
                    self.reply({"success": True, "data": {"state": "succeeded"}})
                else:
                    self.reply({"success": True, "data": {"id": "task-1", "state": "reserved"}, "task_token": "only-this-task"})
            def reply(self, value):
                raw = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.billing = Billing("http://127.0.0.1:" + str(self.server.server_port), {"billing_context": "wbc_identity"})
    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
    def test_developer_fee_has_no_admin_token_or_user_id(self):
        task = self.billing.reserve("order-1", "2.5", "问答")
        body = self.calls[0][2]
        self.assertEqual(body["points"], "2.5")
        self.assertEqual(body["mode"], "developer")
        self.assertNotIn("user_id", body)
        self.assertNotIn("kind", body)
        self.assertNotIn("version", body)
        self.assertNotIn("item_id", body)
        self.assertNotIn("only-this-task", repr(task))
        self.billing.confirm(task)
        self.assertEqual(self.calls[-1][1], "Bearer only-this-task")
        self.assertEqual(self.calls[-1][2], {"status": "succeeded"})
    def test_platform_default_still_uses_rule_version(self):
        self.billing.reserve_default("order-2")
        self.assertEqual(self.calls[-1][2]["version"], 5)
        self.assertEqual(self.calls[-1][2]["mode"], "configured")
    def test_rejects_invalid_or_excessive_cost_before_network(self):
        for points in ["NaN", "Infinity", "-1", "1000.01"]:
            with self.assertRaises(BillingError):
                self.billing.reserve("order-3", points, "问答")
        self.assertEqual(self.calls, [])

if __name__ == "__main__":
    unittest.main()
