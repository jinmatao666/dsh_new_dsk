"""Cancellation must stop live computation, including a launch race."""
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from threading import Event
import time
import unittest
from unittest.mock import patch

from store import Store
from worker import Worker


class WorkerCancelTests(unittest.TestCase):
    def run_cancel_case(self, cancel_before_registration):
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            task_id = secrets.token_hex(16)
            Path(root, task_id).mkdir()
            store.create("owner", "minutes", {}, ["000.txt"], task_id)
            worker = Worker(store, timeout=30)
            spawning = Event()
            release = Event()
            children = []

            def spawn(directory, env):
                child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.DEVNULL, text=True, cwd=directory,
                                         start_new_session=os.name == "posix")
                children.append(child)
                spawning.set()
                if cancel_before_registration:
                    self.assertTrue(release.wait(5))
                return child

            try:
                with patch.object(worker, "_spawn", side_effect=spawn):
                    worker.submit("owner", task_id)
                    self.assertTrue(spawning.wait(5))
                    if not cancel_before_registration:
                        deadline = time.monotonic() + 5
                        while time.monotonic() < deadline:
                            with worker._lock:
                                if task_id in worker._active:
                                    break
                            time.sleep(.01)
                        else:
                            self.fail("worker process was never registered")
                    started = time.monotonic()
                    self.assertTrue(store.cancel("owner", task_id))
                    worker.cancel(task_id)
                    release.set()
                    worker.close()
                    self.assertLess(time.monotonic() - started, 8)
                    self.assertEqual(store.task("owner", task_id)["state"], "cancelled")
                    self.assertIsNotNone(children[0].poll())
            finally:
                release.set()
                for child in children:
                    if child.poll() is None:
                        child.kill()
                    child.wait()

    def test_cancel_live_child_and_launch_race(self):
        for before in (False, True):
            with self.subTest(cancel_before_registration=before):
                self.run_cancel_case(before)


if __name__ == "__main__":
    unittest.main()
