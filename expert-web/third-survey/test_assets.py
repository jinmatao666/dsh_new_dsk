"""Owned legacy assets are served without exposing arbitrary project files."""
import json
import hashlib
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from server import create_server


class AssetTests(unittest.TestCase):
    def test_state_icons_match_owned_manifest(self):
        directory = Path(__file__).parent / "web" / "assets"
        entries = {entry["filename"]: entry for entry in json.loads((directory / "manifest.json").read_text(encoding="utf-8"))["assets"]}
        for key in ("success", "failed", "running"):
            filename = key + ".png"
            self.assertEqual(entries[filename]["source"], "GeologyIconData.ts:" + key)
            self.assertEqual(hashlib.sha256((directory / filename).read_bytes()).hexdigest(), entries[filename]["sha256"])

    def test_assets_and_private_paths(self):
        with tempfile.TemporaryDirectory() as root:
            server = create_server(root, ("127.0.0.1", 0))
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            base = f"http://127.0.0.1:{server.server_port}"
            try:
                with urllib.request.urlopen(base + "/assets/home.png") as response:
                    self.assertEqual(response.headers["Content-Type"], "image/png")
                    self.assertTrue(response.read().startswith(b"\x89PNG"))
                    self.assertIn("frame-src 'none'", response.headers["Content-Security-Policy"])
                with urllib.request.urlopen(base + "/healthz") as response:
                    self.assertEqual(json.loads(response.read()), {"status": "up"})
                with patch("server.ready", return_value=False):
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(base + "/readyz")
                    self.assertEqual(caught.exception.code, 503)
                    self.assertEqual(json.loads(caught.exception.read()), {"status": "not_ready"})
                with patch("server.ready", return_value=True):
                    with urllib.request.urlopen(base + "/readyz") as response:
                        self.assertEqual(json.loads(response.read()), {"status": "ready"})
                for path in ("/assets/missing.png", "/assets/manifest.json", "/assets/../server.py", "/server.py"):
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(base + path)
                    self.assertIn(caught.exception.code, (401, 404))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
                server.worker.close()


if __name__ == "__main__":
    unittest.main()
