"""Manager wire and lifecycle tests; Docker commands are replaced, not executed."""
import base64
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from sandbox_io import parts
from server import Manager, create_server

SESSION = "a" * 32
FILES = [{"path": "SKILL.md", "contentBase64": base64.b64encode(b"test").decode()}]


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.manager = Manager.__new__(Manager)
        self.manager.root = Path(self.temp.name)
        self.manager.lock = threading.RLock()
        self.manager.sessions = {}
        self.manager.image = "runtime:test"
        self.manager.limit = 2
        self.manager.ttl = 600
        self.manager.memory = "2g"
        self.manager.cpus = "2"
        self.manager.workspace = "1g"
        self.manager.retention = 604800
        self.commands = []

        def docker(args, data=None, **kwargs):
            self.commands.append(args)
            return {"exit_code": 0, "limited": False, "output": "container"}
        self.manager.docker = docker
        self.manager.io = lambda session, request, **kwargs: {"entries": []}

    def tearDown(self):
        self.temp.cleanup()

    def test_creation_has_no_network_or_production_mounts(self):
        self.manager.create(SESSION, 1, FILES)
        args = self.commands[0]
        self.assertIn("--read-only", args)
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertEqual(args[args.index("--user") + 1], "65532:65532")
        self.assertNotIn("--volume", args)
        self.assertNotIn("--privileged", args)
        self.assertFalse(any("sock" in value or "SECRET" in value for value in args))

    def test_same_reviewer_cannot_allocate_two_sessions(self):
        self.manager.create(SESSION, 1, FILES)
        with self.assertRaises(ValueError):
            self.manager.create("b" * 32, 1, FILES)

    def test_invalid_paths_rejected_before_docker(self):
        for value in ["../SKILL.md", "/SKILL.md", "a\\b", "a//b", "a/./b"]:
            with self.assertRaises(ValueError):
                self.manager.create(SESSION, 1, [{"path": value, "contentBase64": "YQ=="}])
        self.assertFalse(self.commands)

    def test_teardown_waits_for_concurrent_deletion(self):
        self.manager.create(SESSION, 1, FILES)
        entered, release, second_done = threading.Event(), threading.Event(), threading.Event()
        original = self.manager.docker

        def slow_delete(args, **kwargs):
            if args[0] == "rm":
                entered.set()
                release.wait(2)
            return original(args, **kwargs)
        self.manager.docker = slow_delete
        first = threading.Thread(target=self.manager.finish, args=(SESSION,))
        second = threading.Thread(target=lambda: (self.manager.finish(SESSION), second_done.set()))
        first.start(); entered.wait(2); second.start()
        self.assertFalse(second_done.wait(.05))
        release.set(); first.join(2); second.join(2)
        self.assertTrue(second_done.is_set())
        self.assertNotIn(SESSION, self.manager.sessions)

    def test_failed_deletion_retains_ownership_for_retry(self):
        self.manager.create(SESSION, 1, FILES)
        self.manager.docker = lambda *a, **k: {"exit_code": 1, "limited": False, "output": "error"}
        with self.assertRaises(ValueError):
            self.manager.finish(SESSION)
        self.assertIn(SESSION, self.manager.sessions)
        self.assertFalse(self.manager.sessions[SESSION]["closing"])

    def test_execution_timeout_removes_container(self):
        self.manager.create(SESSION, 1, FILES)
        original = self.manager.docker
        self.manager.docker = lambda args, **kwargs: {"exit_code": 1, "limited": True, "output": "timeout"} if args[:1] == ["exec"] else original(args, **kwargs)
        result = self.manager.tool(SESSION, "execute", {"command": "sleep 90"})
        self.assertIn("error", result)
        self.assertNotIn(SESSION, self.manager.sessions)

    def test_finished_session_saves_only_outputs(self):
        self.manager.create(SESSION, 1, FILES)
        self.manager.files = lambda _: {"files": [{"name": "report.docx", "size": 3}]}
        self.manager.download = lambda *a: {"contentBase64": "YWJj"}
        self.manager.finish(SESSION)
        self.assertEqual((self.manager.root / SESSION / "report.docx").read_bytes(), b"abc")
        self.assertFalse((self.manager.root / SESSION / "SKILL.md").exists())

    def test_authenticated_api_rejects_wrong_secret(self):
        server = create_server(self.manager, "a" * 32, ("127.0.0.1", 0))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            request = Request(f"http://127.0.0.1:{server.server_port}/health", data=b"{}", headers={"Authorization": "Bearer wrong"})
            with self.assertRaises(HTTPError) as raised:
                urlopen(request)
            self.assertEqual(raised.exception.code, 401)
        finally:
            server.shutdown(); server.server_close(); thread.join(2)

    def test_missing_secret_does_not_start_server(self):
        with self.assertRaises(ValueError):
            create_server(self.manager, "short")


if __name__ == "__main__":
    unittest.main()
