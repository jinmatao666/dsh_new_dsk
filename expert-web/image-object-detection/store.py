"""Site-owned SQLite sessions and task records. One service process owns this store."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import secrets
import re
import shutil
import sqlite3
import time


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.database = self.root / "tasks.sqlite3"
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS sessions (
                    digest TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tool TEXT NOT NULL,
                    options TEXT NOT NULL, inputs TEXT NOT NULL, created REAL NOT NULL,
                    state TEXT NOT NULL, error TEXT, outputs TEXT NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS tasks_user ON tasks(user_id, created);
            """)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(tasks)")}
            if "input_names" not in columns:
                db.execute("ALTER TABLE tasks ADD COLUMN input_names TEXT NOT NULL DEFAULT '[]'")
            # A restarted service cannot claim an interrupted conversion succeeded.
            db.execute("UPDATE tasks SET state='failed', error=? WHERE state IN ('queued','running')",
                       ("服务重启，任务已中断，请重新提交",))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def session(self, user_id):
        token = secrets.token_hex(32)
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires <= ?", (time.time(),))
            db.execute("INSERT INTO sessions VALUES (?,?,?)",
                       (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time() + 28800))
        return token

    def user(self, token):
        if not isinstance(token, str) or len(token) != 64:
            return None
        with self.connect() as db:
            row = db.execute("SELECT user_id FROM sessions WHERE digest=? AND expires>?",
                             (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        return row[0] if row else None

    def logout(self, token):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE digest=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def create(self, user, tool, options, inputs, task_id, input_names=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            # Bound disk/CPU intake while the single worker drains queued tasks.
            active = db.execute("SELECT COUNT(*) FROM tasks WHERE state IN ('queued','running')").fetchone()[0]
            if active >= 20:
                raise ValueError("当前任务较多，请稍后重试")
            db.execute("INSERT INTO tasks(id,user_id,tool,options,inputs,created,state,input_names) VALUES(?,?,?,?,?,?,'queued',?)",
                       (task_id, user, tool, json.dumps(options), json.dumps(inputs), time.time(), json.dumps(input_names or inputs)))

    def task(self, user, task_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM tasks WHERE user_id=? AND id=?", (user, task_id)).fetchone()
        return self.decode(row) if row else None

    def list(self, user):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM tasks WHERE user_id=? ORDER BY created DESC LIMIT 100", (user,)).fetchall()
        return [self.decode(row) for row in rows]

    @staticmethod
    def decode(row):
        result = dict(row)
        for key in ("options", "inputs", "outputs", "input_names"):
            result[key] = json.loads(result[key])
        return result

    def claim(self, task_id):
        with self.connect() as db:
            return db.execute("UPDATE tasks SET state='running' WHERE id=? AND state='queued'", (task_id,)).rowcount == 1

    def finish(self, task_id, outputs=None, error=None):
        with self.connect() as db:
            db.execute("UPDATE tasks SET state=?,outputs=?,error=? WHERE id=? AND state='running'",
                       ("failed" if error else "succeeded", json.dumps(outputs or []), error, task_id))

    def cancel(self, user, task_id):
        with self.connect() as db:
            # Running work may finish internally, but its result is never published.
            return db.execute("UPDATE tasks SET state='cancelled' WHERE user_id=? AND id=? AND state IN ('queued','running')",
                              (user, task_id)).rowcount == 1

    def cleanup(self, retention_days=30):
        """Remove expired terminal task directories only; never follow links."""
        if not 1 <= retention_days <= 365:
            raise ValueError("保留天数须在 1–365 之间")
        with self.connect() as db:
            rows = db.execute("SELECT id FROM tasks WHERE created<? AND state NOT IN ('queued','running')",
                              (time.time() - retention_days * 86400,)).fetchall()
            for row in rows:
                task_id = row[0]
                if not re.fullmatch(r"[a-f0-9]{32}", task_id):
                    continue
                directory = self.root / task_id
                if directory.is_symlink() or directory.is_junction():
                    directory.unlink()
                elif directory.exists():
                    if directory.resolve().parent != self.root:
                        raise ValueError("任务目录不在数据目录中")
                    shutil.rmtree(directory)
                db.execute("DELETE FROM tasks WHERE id=?", (task_id,))
            db.execute("DELETE FROM sessions WHERE expires<=?", (time.time(),))
