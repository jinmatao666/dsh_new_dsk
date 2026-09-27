import tempfile
import unittest
import time
from pathlib import Path

from store import Store
from worker import Worker


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_sessions_persist_and_logout(self):
        token = self.store.session("user-a")
        self.assertEqual(Store(self.temp.name).user(token), "user-a")
        self.store.logout(token)
        self.assertIsNone(self.store.user(token))
        self.assertIsNone(self.store.user("wrong"))

    def test_isolation_cancel_and_restart(self):
        self.store.create("a", "pdf-images", {}, ["a.pdf"], "task-a")
        self.assertIsNone(self.store.task("b", "task-a"))
        self.assertFalse(self.store.cancel("b", "task-a"))
        self.assertTrue(self.store.claim("task-a"))
        self.assertTrue(self.store.cancel("a", "task-a"))
        self.store.finish("task-a", ["a.png"])
        self.assertEqual(self.store.task("a", "task-a")["state"], "cancelled")
        self.store.create("a", "pdf-images", {}, ["a.pdf"], "task-b")
        restarted = Store(self.temp.name)
        self.assertEqual(restarted.task("a", "task-b")["state"], "failed")

    def test_real_subprocess_result_persists(self):
        directory = Path(self.temp.name) / "real-task" / "input"
        directory.mkdir(parents=True)
        (directory / "old.txt").write_text("原始内容", encoding="utf-8")
        (directory / "new.txt").write_text("修改内容", encoding="utf-8")
        self.store.create("a", "compare", {}, ["old.txt", "new.txt"], "real-task")
        worker = Worker(self.store)
        try:
            worker.submit("a", "real-task")
        finally:
            worker.close()
        task = self.store.task("a", "real-task")
        self.assertEqual(task["state"], "succeeded")
        target = directory.parent / "output" / task["outputs"][0]
        self.assertTrue(target.is_file())
        self.assertEqual(len(task["outputs"]), 4)

    def test_retention_removes_only_old_terminal_tasks(self):
        old, active = "a" * 32, "b" * 32
        for task_id in (old, active):
            (Path(self.temp.name) / task_id).mkdir()
            self.store.create("a", "pdf-images", {}, ["a.pdf"], task_id)
        self.store.claim(old)
        self.store.finish(old, error="failed")
        with self.store.connect() as db:
            db.execute("UPDATE tasks SET created=?", (time.time() - 40 * 86400,))
        self.store.cleanup(30)
        self.assertIsNone(self.store.task("a", old))
        self.assertFalse((Path(self.temp.name) / old).exists())
        self.assertEqual(self.store.task("a", active)["state"], "queued")
        self.assertTrue((Path(self.temp.name) / active).exists())


if __name__ == "__main__":
    unittest.main()
