"""Original names remain metadata; uploaded storage paths remain service-owned."""
from pathlib import Path
from contextlib import closing
import sqlite3
import tempfile
import unittest

from store import Store


class InputNameTests(unittest.TestCase):
    def test_original_names_survive_restart_and_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            store.create("user-a", "test", {}, ["000.pdf"], "a" * 32,
                         input_names=["中文原稿.pdf"])
            self.assertEqual(store.task("user-a", "a" * 32)["input_names"], ["中文原稿.pdf"])
            self.assertEqual(store.task("user-a", "a" * 32)["inputs"], ["000.pdf"])
            reopened = Store(directory)
            self.assertEqual(reopened.task("user-a", "a" * 32)["input_names"], ["中文原稿.pdf"])
            self.assertIsNone(reopened.task("user-b", "a" * 32))

    def test_existing_schema_migrates_without_losing_task(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "tasks.sqlite3"
            with closing(sqlite3.connect(database)) as db, db:
                db.execute("""CREATE TABLE tasks(
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tool TEXT NOT NULL,
                    options TEXT NOT NULL, inputs TEXT NOT NULL, created REAL NOT NULL,
                    state TEXT NOT NULL, error TEXT, outputs TEXT NOT NULL DEFAULT '[]')""")
                db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)",
                           ("b" * 32, "user-a", "test", "{}", '["000.pdf"]', 1, "succeeded", None, "[]"))
            store = Store(directory)
            self.assertEqual(store.task("user-a", "b" * 32)["input_names"], [])
            self.assertEqual(store.task("user-a", "b" * 32)["inputs"], ["000.pdf"])


if __name__ == "__main__":
    unittest.main()
