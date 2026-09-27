"""Independent conversion website; run behind an HTTPS reverse proxy."""
import base64
import binascii
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import threading
import urllib.error
import urllib.request
from urllib.parse import urlsplit, quote

from store import Store
from worker import Worker
from deployment import ready

PROJECT = Path(__file__).resolve().parent
MAX_BODY = 45 * 1024 * 1024
MAX_FILES = 32 * 1024 * 1024
FORMATS = {".docx", ".pdf", ".xlsx", ".xlsm", ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml"}
TOOLS = {"summary": FORMATS, "compare": FORMATS}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def redeem(ticket):
    endpoint = os.environ["EXPERT_PLATFORM_REDEEM_URL"]
    credential = os.environ["EXPERT_PROVIDER_CREDENTIAL"]
    if urlsplit(endpoint).scheme != "https":
        raise ValueError("票据核验地址必须使用 HTTPS")
    request = urllib.request.Request(endpoint, data=json.dumps({"ticket": ticket}).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {credential}"})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
        return json.loads(response.read(65536))


def create_server(root, address=("127.0.0.1", 4302), redeem_ticket=redeem, public_url=""):
    store = Store(root)
    retention = int(os.environ.get("EXPERT_RETENTION_DAYS", "30"))
    store.cleanup(retention)
    worker = Worker(store)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            # Do not record cookies, tickets, request content or query strings.
            pass

        def response_headers(self, status, content_type, **extra):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            for key, value in extra.items():
                self.send_header(key.replace("_", "-"), value)
            self.end_headers()

        def reply(self, status, body, **extra):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.response_headers(status, "application/json; charset=utf-8", Content_Length=str(len(data)), **extra)
            self.wfile.write(data)

        def body(self):
            if self.headers_in.get("Transfer-Encoding"):
                raise ValueError("不支持分块请求")
            length = int(self.headers_in.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                raise ValueError("请求体超过上限或为空")
            self.connection.settimeout(30)
            payload = self.rfile.read(length)
            if len(payload) != length:
                raise ValueError("上传中断")
            value = json.loads(payload)
            if not isinstance(value, dict):
                raise ValueError("请求格式无效")
            return value

        def identity(self):
            cookie = SimpleCookie()
            cookie.load(self.headers_in.get("Cookie", ""))
            token = cookie.get("expert_document_session")
            return store.user(token.value if token else None)

        def do_GET(self):
            self.handle_request("GET")

        def do_POST(self):
            self.handle_request("POST")

        def handle_request(self, method):
            self.headers_in = self.headers
            try:
                path = urlsplit(self.path).path
                if method == "GET" and path == "/healthz":
                    with store.connect() as database:
                        database.execute("SELECT 1").fetchone()
                    return self.reply(200, {"status": "up"})
                if method == "GET" and path == "/readyz":
                    configured = ready()
                    return self.reply(200 if configured else 503, {"status": "ready" if configured else "not_ready"})
                if method == "GET" and re.fullmatch(r"/assets/[a-z0-9-]+\.(png|webp)", path):
                    asset = PROJECT / "web" / "assets" / path.rsplit("/", 1)[1]
                    if not asset.is_file():
                        return self.reply(404, {"error": "资源不存在"})
                    data = asset.read_bytes()
                    mime = "image/png" if asset.suffix == ".png" else "image/webp"
                    self.response_headers(200, mime, Content_Length=str(len(data)))
                    self.wfile.write(data)
                    return
                if method == "GET" and path in ("/", "/app.js", "/style.css"):
                    name = "index.html" if path == "/" else path[1:]
                    mime = {"index.html": "text/html", "app.js": "text/javascript", "style.css": "text/css"}[name]
                    data = (PROJECT / "web" / name).read_bytes()
                    self.response_headers(200, mime + "; charset=utf-8", Content_Length=str(len(data)))
                    self.wfile.write(data)
                    return
                if method == "POST":
                    origin = self.headers_in.get("Origin")
                    if origin and origin != public_url.rstrip("/"):
                        return self.reply(403, {"error": "请求来源不匹配"})
                    if self.headers_in.get("Content-Type", "").split(";")[0] != "application/json":
                        return self.reply(415, {"error": "仅接受 JSON 请求"})
                if method == "POST" and path == "/api/session":
                    ticket = self.body().get("ticket")
                    if not isinstance(ticket, str) or not re.fullmatch(r"[a-f0-9]{64}", ticket):
                        return self.reply(400, {"error": "登录票据无效"})
                    try:
                        identity = redeem_ticket(ticket)
                    except (OSError, ValueError, KeyError):
                        return self.reply(401, {"error": "登录票据已失效，请重新打开工作台"})
                    if not isinstance(identity, dict):
                        return self.reply(401, {"error": "登录身份无效"})
                    user = identity.get("user_id")
                    if not isinstance(user, str) or not 1 <= len(user) <= 180:
                        return self.reply(401, {"error": "登录身份无效"})
                    token = store.session(user)
                    secure = "; Secure" if public_url.startswith("https://") else ""
                    return self.reply(200, {"user_id": user}, Set_Cookie=f"expert_document_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800{secure}")
                user = self.identity()
                if not user:
                    return self.reply(401, {"error": "请从桌面专家库重新打开工作台"})
                if method == "GET" and path == "/api/tasks":
                    items = store.list(user)
                    for item in items:
                        item.pop("user_id")
                    return self.reply(200, {"items": items})
                if method == "POST" and path == "/api/tasks":
                    store.cleanup(retention)
                    body = self.body()
                    tool, files, options = body.get("tool"), body.get("files"), body.get("options", {})
                    if not isinstance(tool, str) or tool not in TOOLS or not isinstance(files, list) or not 1 <= len(files) <= 30 or not isinstance(options, dict):
                        raise ValueError("工具、文件或参数无效")
                    contents, total = [], 0
                    task_name = options.get("taskName", "")
                    if not isinstance(task_name, str) or len(task_name) > 180 or any(ord(char) < 32 for char in task_name):
                        raise ValueError("任务名称无效")
                    for index, file in enumerate(files):
                        if not isinstance(file, dict) or not isinstance(file.get("name"), str) or not isinstance(file.get("content"), str):
                            raise ValueError("上传文件格式无效")
                        suffix = Path(file["name"]).suffix.lower()
                        if not 1 <= len(file["name"]) <= 255 or "/" in file["name"] or "\\" in file["name"] or any(ord(char) < 32 for char in file["name"]):
                            raise ValueError("上传文件名无效")
                        if suffix not in TOOLS[tool]:
                            raise ValueError("文件类型与工具不匹配")
                        data = base64.b64decode(file["content"], validate=True)
                        total += len(data)
                        if not data or total > MAX_FILES:
                            raise ValueError("文件为空或总大小超过 32 MB")
                        contents.append((f"{index:03d}{suffix}", data))
                    task_id = secrets.token_hex(16)
                    directory = store.root / task_id / "input"
                    directory.mkdir(parents=True, mode=0o700)
                    for name, data in contents:
                        target = directory / name
                        with target.open("xb") as file:
                            file.write(data)
                        target.chmod(0o600)
                    try:
                        store.create(user, tool, options, [name for name, _ in contents], task_id,
                                     input_names=[file["name"] for file in files])
                    except Exception:
                        # This exact service-created task has no database owner yet.
                        if directory.parent.resolve().parent == store.root:
                            shutil.rmtree(directory.parent)
                        raise
                    worker.submit(user, task_id)
                    return self.reply(201, {"id": task_id})
                match = re.fullmatch(r"/api/tasks/([a-f0-9]{32})/(cancel|files/([0-9]+))", path)
                if match:
                    task = store.task(user, match[1])
                    if not task:
                        return self.reply(404, {"error": "任务不存在"})
                    if method == "POST" and match[2] == "cancel":
                        self.body()
                        cancelled = store.cancel(user, match[1])
                        if cancelled:
                            worker.cancel(match[1])
                        return self.reply(200, {"cancelled": cancelled})
                    if method == "GET" and match[3] is not None and task["state"] == "succeeded":
                        index = int(match[3])
                        if index >= len(task["outputs"]):
                            return self.reply(404, {"error": "成果不存在"})
                        name = task["outputs"][index]
                        file_path = store.root / task["id"] / "output" / name
                        self.response_headers(200, "application/octet-stream", Content_Length=str(file_path.stat().st_size),
                                     Content_Disposition=f"attachment; filename*=UTF-8''{quote(name)}")
                        with file_path.open("rb") as file:
                            while chunk := file.read(65536):
                                self.wfile.write(chunk)
                        return
                self.reply(404, {"error": "接口不存在"})
            except (ValueError, binascii.Error):
                self.reply(400, {"error": "请求无效，请检查文件格式、参数和上传大小"})
            except (BrokenPipeError, ConnectionResetError):
                pass  # Client disconnected; never retry response writes.
            except Exception:
                self.reply(500, {"error": "服务异常，请稍后重试"})

    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = False
    server.store = store
    server.worker = worker
    return server


if __name__ == "__main__":
    for key in ("EXPERT_PLATFORM_REDEEM_URL", "EXPERT_PROVIDER_CREDENTIAL", "EXPERT_PUBLIC_URL"):
        if not os.environ.get(key):
            raise SystemExit(f"缺少环境变量：{key}")
    app = create_server(os.environ.get("EXPERT_DATA_DIR", PROJECT / "data"),
                        (os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "4302"))),
                        public_url=os.environ["EXPERT_PUBLIC_URL"])
    def stop(_signum, _frame):
        threading.Thread(target=app.shutdown).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        app.serve_forever()
    finally:
        app.server_close()
        app.worker.close()
