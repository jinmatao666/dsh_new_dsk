"""Run untrusted document processing outside the HTTP process with a deadline."""
import json
import os
from pathlib import Path
import subprocess
import sys
import signal
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from extract import DocumentError
from minutes import create_minutes


class Worker:
    def __init__(self, store, timeout=3600):
        self.store = store
        self.timeout = timeout
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="conversion")
        self._lock = Lock()
        self._active = {}
        self._cancelled = set()

    def submit(self, user, task_id):
        self.executor.submit(self.run, user, task_id)

    @staticmethod
    def _stop(process):
        if process.poll() is not None:
            return
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            # Kill nested converters too; a direct process.kill() leaves them running.
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            if process.poll() is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass

    def cancel(self, task_id):
        with self._lock:
            self._cancelled.add(task_id)
            process = self._active.get(task_id)
        if process is not None:
            self._stop(process)

    @staticmethod
    def _spawn(directory, env):
        return subprocess.Popen([sys.executable, str(Path(__file__).resolve()), str(directory)],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, encoding="utf-8", env=env, cwd=directory,
                                start_new_session=os.name == "posix")

    def run(self, user, task_id):
        if not self.store.claim(task_id):
            with self._lock:
                self._cancelled.discard(task_id)
            return
        task = self.store.task(user, task_id)
        directory = self.store.root / task_id
        # Credentials are deliberately not inherited by conversion subprocesses.
        env = {key: value for key, value in os.environ.items()
               if not any(part in key.upper() for part in ("KEY", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL"))}
        try:
            with self._spawn(directory, env) as process:
                with self._lock:
                    self._active[task_id] = process
                    cancelled = task_id in self._cancelled
                if cancelled:
                    self._stop(process)
                try:
                    stdout, _ = process.communicate(json.dumps({"task": task, "model": {key: os.environ.get(key, "") for key in ("EXPERT_MODEL_URL", "EXPERT_MODEL", "EXPERT_MODEL_KEY", "EXPERT_ASR_URL", "EXPERT_ASR_MODEL", "EXPERT_ASR_KEY", "EXPERT_ASR_PROTOCOL")}}), timeout=self.timeout)
                except subprocess.TimeoutExpired:
                    self._stop(process)
                    process.communicate()
                    raise
            if process.returncode != 0:
                self.store.finish(task_id, error="文件处理失败，请检查文件是否损坏或格式不受支持")
                return
            response = json.loads(stdout)
            if response.get("error"):
                self.store.finish(task_id, error=response["error"])
                return
            outputs = response["outputs"]
            if not isinstance(outputs, list) or not outputs:
                raise ValueError("missing outputs")
            for name in outputs:
                if Path(name).name != name or not (directory / "output" / name).is_file():
                    raise ValueError("invalid output")
            self.store.finish(task_id, outputs=outputs)
        except subprocess.TimeoutExpired:
            # Both the worker and nested converter have been killed and awaited.
            self.store.finish(task_id, error="处理超时，请减少文件或降低分辨率后重试")
        except (OSError, ValueError, KeyError):
            self.store.finish(task_id, error="任务处理异常，请重新提交")
        finally:
            with self._lock:
                self._active.pop(task_id, None)
                self._cancelled.discard(task_id)

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)


if __name__ == "__main__":
    if os.name == "posix":
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024 * 1024, 128 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (600, 600))
    sys.stdout.reconfigure(encoding="utf-8")
    root = Path(sys.argv[1]).resolve()
    payload = json.load(sys.stdin)
    task = payload["task"]
    for key, value in payload["model"].items():
        os.environ[key] = value
    try:
        paths = [root / "input" / name for name in task["inputs"]]
        outputs = create_minutes(paths, root / "output", task["options"], input_names=task.get("input_names") or None)
        print(json.dumps({"outputs": [path.name for path in outputs]}))
    except DocumentError as error:
        print(json.dumps({"error": str(error)}))
