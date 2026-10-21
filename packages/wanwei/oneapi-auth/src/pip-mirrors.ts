/** Process-local Python module overlay; never edits the user's installed pip or pip configuration. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Ordered indexes and the complete time budget for each pip attempt. */
export interface PipMirrorPolicy {
  indexes: string[]
  attemptSeconds: number
}

/** Creates a private module overlay for `python -m pip`; other pip entry points are unchanged. */
export class PipMirrors {
  private directory: string | undefined

  constructor(readonly policy: PipMirrorPolicy) {
    if (!Number.isInteger(policy.attemptSeconds) || policy.attemptSeconds < 1 || policy.attemptSeconds > 600
      || policy.indexes.length < 1 || policy.indexes.length > 3) throw new Error('Invalid pip mirror policy')
    for (const raw of policy.indexes) {
      const url = new URL(raw)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('Pip mirrors require credential-free HTTPS index URLs')
      }
    }
  }

  /** Materialize the overlay once; the caller prepends it to its children's PYTHONPATH.
   * @returns An owned, random module-search directory.
   */
  start(): string {
    if (this.directory) return this.directory
    const directory = mkdtempSync(join(tmpdir(), 'wanwei-pip-'))
    try {
      mkdirSync(join(directory, 'pip'))
      writeFileSync(join(directory, 'pip', '__init__.py'), PIP_INIT, { mode: 0o600 })
      writeFileSync(join(directory, 'pip', '__main__.py'), PIP_MAIN, { mode: 0o600 })
    } catch (error) {
      rmSync(directory, { recursive: true, force: true })
      throw error
    }
    this.directory = directory
    return directory
  }

  /** Remove only the generated overlay after the Host has stopped its child commands. */
  dispose(): void {
    if (!this.directory) return
    rmSync(this.directory, { recursive: true, force: true })
    this.directory = undefined
  }
}

const PIP_INIT = String.raw`"""Delegate pip imports to the existing installation, preserving its package API."""
import importlib.machinery
import os
import sys

_overlay = os.path.realpath(os.path.dirname(os.path.dirname(__file__)))
_paths = [p for p in sys.path if os.path.realpath(p or os.curdir) != _overlay]
_real = importlib.machinery.PathFinder.find_spec("pip", _paths)
if _real is None or _real.origin is None:
    raise ModuleNotFoundError("No installed pip found for this Python interpreter")
__path__ = [os.path.dirname(__file__), *list(_real.submodule_search_locations or [])]
__file__ = _real.origin
with open(_real.origin, "rb") as _source:
    exec(compile(_source.read(), _real.origin, "exec"), globals())
`

const PIP_MAIN = String.raw`"""Bounded sequential mirror attempts for default-index pip downloads and installs."""
import json
import os
import signal
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

def real_pip():
    from pip._internal.cli.main import main
    return main()

def stop(child):
    if child.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if child.poll() is None:
        child.kill()
    child.wait()

def managed_pip():
    args = sys.argv[1:]
    explicit = ("--index-url", "--extra-index-url", "--no-index", "--find-links",
                "--proxy", "--isolated", "--help", "--version", "--dry-run",
                "--report", "--log")
    if (os.environ.get("DSH_PIP_MIRROR_CHILD") == "1"
        or not args or args[0] not in ("download", "install")
        or any(a.split("=", 1)[0] in explicit or a.startswith(("-i", "-f", "-h", "-V")) for a in args)
        or os.environ.get("PIP_NO_INDEX", "").lower() in ("1", "true", "yes")):
        return real_pip()

    indexes = json.loads(os.environ["DSH_PIP_MIRROR_INDEXES"])
    seconds = int(os.environ["DSH_PIP_MIRROR_SECONDS"])
    # 每个源用独立进程，避免 pip 的解析缓存或上一次安装状态污染下一次尝试。
    for number, index in enumerate(indexes, 1):
        print("[wanwei-pip] mirror %d/%d: %s" % (number, len(indexes), urlsplit(index).hostname), flush=True)
        env = os.environ.copy()
        env.update(DSH_PIP_MIRROR_CHILD="1", PIP_INDEX_URL=index,
                   PIP_EXTRA_INDEX_URL="", PIP_RETRIES="0", PIP_RESUME_RETRIES="0")
        with tempfile.TemporaryFile() as log:
            child = subprocess.Popen([sys.executable, "-m", "pip", *args, "--retries", "0"], env=env,
                stdout=log, stderr=subprocess.STDOUT,
                start_new_session=os.name != "nt",
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            timed_out = False
            try:
                code = child.wait(timeout=seconds)
            except subprocess.TimeoutExpired:
                timed_out = True
                stop(child)
                code = 124
            except BaseException:
                stop(child)
                raise
            log.seek(0)
            while True:
                block = log.read(65536)
                if not block:
                    break
                sys.stdout.write(block.decode(errors="replace"))
            length = log.tell()
            log.seek(max(0, length - 65536))
            diagnostic = log.read().decode(errors="replace").lower()
        sys.stdout.flush()
        if code == 0:
            print("[wanwei-pip] result: success", flush=True)
            return 0
        if timed_out:
            print("[wanwei-pip] attempt timed out after %d seconds" % seconds, flush=True)
        # 权限、构建、参数、哈希校验和用户取消都不通过换源修复。
        terminal = ("permission denied", "access is denied", "winerror 5", "errno 13",
                    "failed building wheel", "subprocess-exited-with-error", "hash mismatch",
                    "do not match the hashes",
                    "no such option", "invalid requirement", "operation cancelled",
                    "keyboardinterrupt", "no space left")
        retryable = ("no matching distribution found", "could not find a version",
                     "proxyerror", "connectionerror", "connection broken", "timed out",
                     "connection refused", "network is unreachable", "http error",
                     "could not fetch url", "sslerror", "readtimeout", "connecttimeout")
        if (any(text in diagnostic for text in terminal)
            or not (timed_out or any(text in diagnostic for text in retryable))):
            return code
    return code

raise SystemExit(managed_pip())
`
