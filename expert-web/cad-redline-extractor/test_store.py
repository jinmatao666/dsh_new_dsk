import tempfile
import time
import unittest
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

    def test_real_coordinate_subprocess_result_persists(self):
        directory = Path(self.temp.name) / "real-task" / "input"
        directory.mkdir(parents=True)
        (directory / "a.csv").write_text("x,y\n120,30\n", encoding="utf-8")
        self.store.create("a", "coordinate-transform",
                          {"method": "epsg", "sourceEpsg": "4326", "targetEpsg": "4547", "xField": "x", "yField": "y"},
                          ["a.csv"], "real-task")
        worker = Worker(self.store)
        try:
            worker.submit("a", "real-task")
        finally:
            worker.close()
        task = self.store.task("a", "real-task")
        self.assertEqual(task["state"], "succeeded", task)
        target = directory.parent / "output" / task["outputs"][0]
        self.assertTrue(target.is_file())
        self.assertIn("x_out", target.read_text(encoding="utf-8-sig"))

    def test_retention_removes_only_old_terminal_tasks(self):
        old, active = "a" * 32, "b" * 32
        for task_id in (old, active):
            (Path(self.temp.name) / task_id).mkdir()
            self.store.create("a", "coordinate-transform", {}, ["a.csv"], task_id)
        self.store.claim(old)
        self.store.finish(old, error="failed")
        with self.store.connect() as db:
            db.execute("UPDATE tasks SET created=?", (time.time() - 40 * 86400,))
        self.store.cleanup(30)
        self.assertIsNone(self.store.task("a", old))
        self.assertFalse((Path(self.temp.name) / old).exists())
        self.assertEqual(self.store.task("a", active)["state"], "queued")

    def test_delete_removes_terminal_task_and_files(self):
        task_id = "e" * 32
        path = Path(self.temp.name) / task_id
        path.mkdir()
        (path / "marker.txt").write_text("x", encoding="utf-8")
        self.store.create("a", "redline-extract", {}, ["a.dxf"], task_id)
        with self.assertRaisesRegex(ValueError, "取消"):
            self.store.delete("a", task_id)
        self.store.claim(task_id)
        self.store.finish(task_id, error="failed")
        self.assertFalse(self.store.delete("b", task_id))
        self.assertTrue(self.store.delete("a", task_id))
        self.assertIsNone(self.store.task("a", task_id))
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
