import base64
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from server import create_server, TOOLS


class MetadataTests(unittest.TestCase):
    def test_invalid_task_names_do_not_create_tasks(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_server(directory, ("127.0.0.1", 0), redeem_ticket=lambda _: {"user_id": "a"})
            thread = threading.Thread(target=app.serve_forever)
            thread.start()
            base = f"http://127.0.0.1:{app.server_port}"
            def request(path, body, cookie=""):
                return urllib.request.urlopen(urllib.request.Request(base + path,
                    data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Cookie": cookie}))
            try:
                with request("/api/session", {"ticket": "a" * 64}) as response:
                    cookie = response.headers["Set-Cookie"].split(";")[0]
                tool = next(iter(TOOLS))
                suffix = sorted(TOOLS[tool])[0]
                for name in (123, "a" * 181, "title\nnewline"):
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        request("/api/tasks", {"tool": tool, "options": {"taskName": name},
                            "files": [{"name": "input" + suffix, "content": base64.b64encode(b"dummy").decode()}]}, cookie)
                    self.assertEqual(caught.exception.code, 400)
                self.assertEqual(app.store.list("a"), [])
            finally:
                app.shutdown()
                app.server_close()
                thread.join()
                app.worker.close()


if __name__ == "__main__":
    unittest.main()
