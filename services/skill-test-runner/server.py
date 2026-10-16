"""Authenticated sandbox manager. Uploaded code runs only in disposable containers."""
import base64
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import threading
import time

from sandbox_io import parts

ID = re.compile(r"^[a-f0-9]{32}$")
IO_CODE = Path(__file__).with_name("sandbox_io.py").read_text(encoding="utf-8")
MAX_OUTPUT = 128 * 1024
MAX_REQUEST = 120 * 1024 * 1024


class Manager:
    def __init__(self):
        self.image = os.environ.get("SKILL_TEST_IMAGE", "wanwei-skill-test-runtime:1")
        self.ttl = int(os.environ.get("SKILL_TEST_SESSION_SECONDS", "600"))
        self.limit = int(os.environ.get("SKILL_TEST_CONCURRENCY", "2"))
        self.memory = os.environ.get("SKILL_TEST_MEMORY", "2g")
        self.cpus = os.environ.get("SKILL_TEST_CPUS", "2")
        self.workspace = os.environ.get("SKILL_TEST_WORKSPACE_SIZE", "1g")
        self.retention = int(os.environ.get("SKILL_TEST_RETENTION_SECONDS", "604800"))
        if not 60 <= self.ttl <= 3600 or not 1 <= self.limit <= 20 or self.retention < 3600:
            raise ValueError("测试时长、并发或保留时长配置无效")
        self.root = Path(os.environ.get("SKILL_TEST_RESULTS_DIR", "/data/results"))
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.sessions = {}
        # Restarted managers remove only containers bearing their exact managed label.
        stale = self.docker(["ps", "-aq", "--filter", "label=wanwei.skill-test.managed=1"])["output"].split()
        for container in stale:
            if re.fullmatch(r"[a-f0-9]{12,64}", container):
                self.docker(["rm", "-f", container])

    def docker(self, args, data=None, timeout=60, max_output=MAX_OUTPUT):
        with tempfile.TemporaryFile() as source, tempfile.TemporaryFile() as output:
            if data is not None:
                source.write(data.encode())
                source.seek(0)
            process = subprocess.Popen(["docker", *args], stdin=source, stdout=output, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + timeout
            limited = False
            while process.poll() is None:
                if time.monotonic() >= deadline or os.fstat(output.fileno()).st_size > max_output:
                    limited = True
                    process.kill()
                    break
                time.sleep(0.02)
            process.wait()
            limited = limited or os.fstat(output.fileno()).st_size > max_output
            output.seek(0)
            return {"exit_code": process.returncode, "output": output.read(max_output).decode("utf-8", errors="replace"),
                    "limited": limited}

    def name(self, session):
        if not isinstance(session, str) or not ID.fullmatch(session):
            raise ValueError("测试会话 ID 无效")
        return "wanwei-skill-test-" + session

    def io(self, session, request, large=False, as_root=False):
        user = ["--user", "0:0"] if as_root else []
        result = self.docker(["exec", "-i", *user, self.name(session), "/usr/local/bin/python", "-I", "-c", IO_CODE],
                             json.dumps(request), max_output=30 * 1024 * 1024 if large else MAX_OUTPUT)
        if result["exit_code"] or result["limited"]:
            raise ValueError("文件操作失败：" + result["output"][:1000])
        return json.loads(result["output"])

    def create(self, session, owner, files):
        name = self.name(session)
        if not isinstance(owner, int) or owner <= 0 or not isinstance(files, list) or not 1 <= len(files) <= 500:
            raise ValueError("会话参数无效")
        total, seen = 0, set()
        for item in files:
            path = item["path"]
            parts(path)
            if path in seen:
                raise ValueError("技能文件重复")
            seen.add(path)
            content = base64.b64decode(item["contentBase64"], validate=True)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError("技能文件超过 20 MB")
            total += len(content)
        if total > 80 * 1024 * 1024 or "SKILL.md" not in seen:
            raise ValueError("技能包超过限制或缺少 SKILL.md")
        with self.lock:
            if session in self.sessions or len(self.sessions) >= self.limit:
                raise ValueError("测试并发已满，请先结束其他会话")
            if any(item["owner"] == owner for item in self.sessions.values()):
                raise ValueError("请先结束您正在使用的测试会话")
            self.sessions[session] = {"owner": owner, "deadline": time.monotonic() + self.ttl,
                                      "operation": threading.Lock(), "closing": False, "done": threading.Event()}
            result = self.docker(["run", "-d", "--name", name, "--label", "wanwei.skill-test.managed=1",
                                  "--network", "none", "--read-only", "--cap-drop", "ALL",
                                  "--security-opt", "no-new-privileges:true", "--pids-limit", "128",
                                  "--memory", self.memory, "--memory-swap", self.memory, "--cpus", self.cpus,
                                  "--user", "65532:65532", "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m,uid=65532,gid=65532",
                                  "--tmpfs", "/workspace:rw,nosuid,nodev,size=" + self.workspace + ",uid=0,gid=0,mode=1777",
                                  "--workdir", "/workspace", "--env", "HOME=/workspace", self.image, "sleep", "infinity"])
            if result["exit_code"]:
                self.finish(session)
                raise ValueError("执行容器创建失败，请检查运行模板镜像")
        try:
            for item in files:
                self.io(session, {"action": "write", "path": "skill/" + item["path"],
                                  "contentBase64": item["contentBase64"]}, as_root=True)
            result = self.docker(["exec", name, "mkdir", "-p", "input", "output"])
            if result["exit_code"]:
                raise ValueError("工作区创建失败")
            # Preserve the uploaded version: the untrusted UID cannot edit or chmod it.
            for command in (["chmod", "-R", "a-w,a+rX", "skill"],):
                result = self.docker(["exec", "--user", "0:0", name, *command])
                if result["exit_code"]:
                    raise ValueError("技能快照只读保护失败")
        except BaseException:
            self.finish(session)
            raise
        return {"ready": True, "expires_in": self.ttl}

    def active(self, session):
        self.name(session)
        with self.lock:
            item = self.sessions.get(session)
            if item is None or item["closing"] or time.monotonic() >= item["deadline"]:
                raise ValueError("测试会话已结束或超时，请新建测试")
            return item

    def tool(self, session, tool, args):
        item = self.active(session)
        if not item["operation"].acquire(blocking=False):
            raise ValueError("会话正在执行其他操作")
        try:
            self.active(session)
            if tool == "execute":
                command = args.get("command")
                if not isinstance(command, str) or not 1 <= len(command) <= 16000:
                    raise ValueError("执行命令无效")
                result = self.docker(["exec", self.name(session), "/bin/sh", "-c", command],
                                     timeout=min(60, max(1, item["deadline"] - time.monotonic())))
                if result["limited"]:
                    self.finish(session)
                    result["error"] = "命令超时或输出超限，执行容器已停止"
                return result
            path = args.get("path", "output")
            parts(path)
            if tool == "list_files":
                return self.io(session, {"action": "list", "path": path})
            if tool == "read_file":
                data = self.io(session, {"action": "read", "path": path}, large=True)
                content = base64.b64decode(data["contentBase64"])
                return {"content": content[:16000].decode("utf-8", errors="replace"), "truncated": len(content) > 16000}
            if tool == "write_file":
                content = args.get("content")
                if not isinstance(content, str) or len(content.encode()) > 128000:
                    raise ValueError("写入内容超过限制")
                return self.io(session, {"action": "write", "path": path,
                                         "contentBase64": base64.b64encode(content.encode()).decode()})
            raise ValueError("不支持的测试工具")
        finally:
            item["operation"].release()

    def upload(self, session, files):
        self.active(session)
        if not isinstance(files, list) or len(files) > 10:
            raise ValueError("一次最多上传 10 个文件")
        total, seen = 0, set()
        for item in files:
            parts(item["name"])
            if "/" in item["name"] or item["name"] in seen:
                raise ValueError("上传文件名不能包含目录或重复")
            seen.add(item["name"])
            length = len(base64.b64decode(item["contentBase64"], validate=True))
            if length > 20 * 1024 * 1024:
                raise ValueError("输入文件超过20 MB")
            total += length
        if total > 80 * 1024 * 1024:
            raise ValueError("输入文件合计超过80 MB")
        operation = self.active(session)["operation"]
        if not operation.acquire(blocking=False):
            raise ValueError("会话正在执行其他操作")
        try:
            for item in files:
                self.active(session)
                self.io(session, {"action": "write", "path": "input/" + item["name"],
                                  "contentBase64": item["contentBase64"]})
        finally:
            operation.release()
        return {"paths": ["input/" + item["name"] for item in files]}

    def files(self, session):
        self.name(session)
        result = self.root / session
        if session in self.sessions:
            entries = self.io(session, {"action": "list", "path": "output"})["entries"]
            return {"files": [{"name": x["name"], "size": x["size"]} for x in entries
                              if x["file"] and x["size"] <= 20 * 1024 * 1024][:20]}
        if not result.is_dir():
            return {"files": []}
        return {"files": [{"name": p.name, "size": p.stat().st_size} for p in sorted(result.iterdir())
                          if p.is_file() and not p.is_symlink()]}

    def download(self, session, name):
        self.name(session)
        parts(name)
        if "/" in name:
            raise ValueError("产物文件名无效")
        if session in self.sessions:
            return self.io(session, {"action": "read", "path": "output/" + name}, large=True)
        path = self.root / session / name
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise ValueError("产物不是普通文件")
            data = source.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise ValueError("产物文件超过限制")
        return {"contentBase64": base64.b64encode(data).decode(), "size": len(data)}

    def finish(self, session):
        self.name(session)
        with self.lock:
            item = self.sessions.get(session)
            if item is None:
                return {"ended": True}
            waiting = item["closing"]
            if not waiting:
                item["done"].clear()
            item["closing"] = True
        if waiting:
            if not item["done"].wait(180):
                raise ValueError("容器仍在清理，请稍后重试")
            with self.lock:
                if session in self.sessions:
                    raise ValueError("容器删除未完成，请重试")
            return {"ended": True}
        warning = ""
        try:
            destination = self.root / session
            destination.mkdir(mode=0o700, exist_ok=True)
            total = 0
            for file in self.files(session)["files"]:
                if total + file["size"] > 80 * 1024 * 1024:
                    warning = "产物超过保留上限，部分文件未保存"
                    break
                data = self.download(session, file["name"])
                content = base64.b64decode(data["contentBase64"], validate=True)
                total += len(content)
                if total > 80 * 1024 * 1024:
                    warning = "产物超过保留上限，部分文件未保存"
                    break
                with (destination / file["name"]).open("wb") as output:
                    output.write(content)
        except (ValueError, OSError, KeyError, json.JSONDecodeError):
            warning = "部分产物未能保存，请查看已保留文件"
        finally:
            try:
                result = self.docker(["rm", "-f", self.name(session)])
            except OSError as error:
                with self.lock:
                    item["closing"] = False
                    item["done"].set()
                raise ValueError("容器删除未完成，将重试清理") from error
            if result["exit_code"]:
                # Keep ownership so the sweeper retries instead of losing a live container.
                with self.lock:
                    item["closing"] = False
                    item["done"].set()
                raise ValueError("容器删除未完成，将重试清理")
            with self.lock:
                self.sessions.pop(session, None)
                item["done"].set()
        return {"ended": True, "warning": warning}

    def sweep(self):
        with self.lock:
            expired = [key for key, value in self.sessions.items() if time.monotonic() >= value["deadline"]]
        for key in expired:
            try:
                self.finish(key)
            except (ValueError, OSError):
                pass  # Ownership is retained; the next sweep retries deletion.
        for folder in self.root.iterdir():
            if folder.is_symlink() or not folder.is_dir() or not ID.fullmatch(folder.name):
                continue
            if folder.name in self.sessions or time.time() - folder.stat().st_mtime <= self.retention:
                continue
            for file in folder.iterdir():
                if file.is_symlink() or file.is_file():
                    file.unlink()
            try:
                folder.rmdir()
            except OSError:
                pass  # Unexpected directories are never recursively traversed.


def create_server(manager, secret, address=("0.0.0.0", 9080)):
    if len(secret) < 32 or secret.startswith("replace"):
        raise ValueError("SKILL_TEST_RUNNER_SECRET 至少需要 32 个字符")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log uploaded files, commands or bearer credentials.

        def do_POST(self):
            if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), ("Bearer " + secret).encode()):
                return self.reply(401, {"error": "无权访问测试服务"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_REQUEST:
                    return self.reply(413, {"error": "请求超过限制"})
                body = json.loads(self.rfile.read(size))
                session = body.get("session", "")
                if self.path == "/health":
                    result = manager.docker(["image", "inspect", manager.image], max_output=MAX_OUTPUT)
                    return self.reply(200 if result["exit_code"] == 0 else 503, {"ready": result["exit_code"] == 0, "retention_seconds": manager.retention})
                if self.path == "/create":
                    result = manager.create(session, body["owner"], body["files"])
                elif self.path == "/tool":
                    result = manager.tool(session, body["tool"], body["arguments"])
                elif self.path == "/upload":
                    result = manager.upload(session, body["files"])
                elif self.path == "/files":
                    result = manager.files(session)
                elif self.path == "/status":
                    manager.name(session)
                    with manager.lock:
                        item = manager.sessions.get(session)
                        result = {"active": item is not None and not item["closing"] and time.monotonic() < item["deadline"]}
                elif self.path == "/download":
                    result = manager.download(session, body["name"])
                elif self.path == "/finish":
                    result = manager.finish(session)
                else:
                    return self.reply(404, {"error": "接口不存在"})
                self.reply(200, result)
            except (ValueError, KeyError, OSError, TypeError):
                self.reply(400, {"error": "测试操作失败，请检查会话、文件或运行环境"})

        def reply(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Client disconnected; never retry response writes.

    return ThreadingHTTPServer(address, Handler)


if __name__ == "__main__":
    secret = os.environ.get("SKILL_TEST_RUNNER_SECRET", "")
    if len(secret) < 32 or secret.startswith("replace"):
        raise ValueError("请先配置随机的 SKILL_TEST_RUNNER_SECRET")
    manager = Manager()
    server = create_server(manager, secret)
    def cleanup():
        while True:
            time.sleep(15)
            manager.sweep()
    threading.Thread(target=cleanup, daemon=True).start()
    server.serve_forever()
