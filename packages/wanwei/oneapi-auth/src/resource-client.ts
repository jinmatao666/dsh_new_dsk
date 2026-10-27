/** Python resource client exposed only to newly spawned intranet relay commands. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Exposes the Python resource helper to child processes and restores their environment on disposal. */
export class ResourceClient {
  private directory: string | undefined

  /** Materialize a standard-library Python module without installing a package.
   * @returns Owned module-search directory for the sidecar's child environment.
   */
  start(): string {
    if (this.directory) return this.directory
    const directory = mkdtempSync(join(tmpdir(), 'wanwei-resource-'))
    try { writeFileSync(join(directory, 'wanwei_resource.py'), RESOURCE_CLIENT, { mode: 0o600 }) }
    catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
    this.directory = directory
    return directory
  }

  /** Remove only the owned module directory; existing children must be stopped before disposal. */
  dispose(): void {
    if (!this.directory) return
    rmSync(this.directory, { recursive: true, force: true })
    this.directory = undefined
  }
}

const RESOURCE_CLIENT = String.raw`"""Read a specified public page or download a file using the managed HTTP(S) route."""
import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

def valid_url(raw):
    value = urlsplit(raw)
    if (value.scheme not in ("http", "https") or not value.hostname
            or value.username is not None or value.password is not None):
        raise ValueError("Only credential-free HTTP(S) URLs are supported")
    return raw

class Redirects(HTTPRedirectHandler):
    def __init__(self):
        self.hops = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops += 1
        if self.hops > 5:
            raise ValueError("Too many redirects (maximum 5)")
        valid_url(newurl)
        if urlsplit(req.full_url).scheme == "https" and urlsplit(newurl).scheme != "https":
            raise ValueError("HTTPS downgrade redirect rejected")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class Page(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.text, self.links, self.hidden = base, [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag == "a" and len(self.links) < 200:
            href = dict(attrs).get("href")
            if href:
                try:
                    link = valid_url(urljoin(self.base, href))
                    if link not in self.links:
                        self.links.append(link)
                except ValueError:
                    pass

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.text.append(data.strip())

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--output", help="Explicit destination within the current workspace; never overwritten")
    parser.add_argument("--max-bytes", type=int, default=100 * 1024 * 1024)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    valid_url(args.url)
    if args.max_bytes < 1 or not 0 < args.timeout <= 3600:
        raise ValueError("Invalid byte limit or timeout")
    destination = None
    if args.output:
        root = Path.cwd().resolve()
        destination = Path(args.output).resolve()
        if root not in destination.parents:
            raise ValueError("Download destination must be inside the current workspace")
        if destination.exists():
            raise FileExistsError("Destination exists; choose another filename")
    # Explicit environment-only proxies avoid consulting machine/user registry proxy settings.
    proxies = {scheme: os.environ.get(scheme.upper() + "_PROXY") for scheme in ("http", "https")}
    opener = build_opener(ProxyHandler({k: v for k, v in proxies.items() if v}), Redirects())
    deadline = time.monotonic() + args.timeout
    request = Request(args.url, headers={"User-Agent": "WanweiBuddy-resource/1", "Accept-Encoding": "identity"})
    temporary = None
    try:
        with opener.open(request, timeout=args.timeout) as response:
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > args.max_bytes:
                raise ValueError("Resource exceeds the configured byte limit")
            mime = response.headers.get_content_type()
            charset = response.headers.get_content_charset() or "utf-8"
            if destination and mime == "text/html" and destination.suffix.lower() not in (".html", ".htm"):
                raise ValueError("Server returned an HTML page instead of the requested file")
            if not destination and not (mime.startswith("text/") or mime in ("application/json", "application/xml")):
                raise ValueError("Binary resource: repeat with --output and an explicit filename")
            total, digest, preview = 0, hashlib.sha256(), bytearray()
            if destination:
                destination.parent.mkdir(parents=True, exist_ok=True)
                fd, temporary = tempfile.mkstemp(prefix=".wanwei-download-", dir=str(destination.parent))
                stream = os.fdopen(fd, "wb")
            else:
                stream = None
            try:
                while True:
                    if time.monotonic() > deadline:
                        raise TimeoutError("Resource transfer exceeded its time budget")
                    block = response.read1(65536)
                    if not block:
                        break
                    total += len(block)
                    if total > args.max_bytes:
                        raise ValueError("Resource exceeds the configured byte limit")
                    digest.update(block)
                    if stream:
                        stream.write(block)
                    elif len(preview) < 262144:
                        preview.extend(block[:262144 - len(preview)])
            finally:
                if stream:
                    stream.close()
            if declared and total != int(declared):
                raise ValueError("Incomplete resource response")
            result = {"url": response.geturl(), "status": response.status, "content_type": mime,
                      "bytes": total, "sha256": digest.hexdigest()}
            if destination:
                # Atomic publication that fails rather than replacing a concurrently created destination.
                os.link(temporary, destination)
                result["path"] = str(destination)
            else:
                text = preview.decode(charset, errors="replace")
                links = []
                if mime == "text/html":
                    page = Page(response.geturl())
                    page.feed(text)
                    text, links = "\n".join(page.text), page.links
                result.update(text=text[:60000], links=links,
                              truncated=total > len(preview) or len(text) > 60000,
                              untrusted_content=True)
            print(json.dumps(result, ensure_ascii=True))
    finally:
        if temporary:
            os.unlink(temporary)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # urllib errors can contain signed URLs; do not echo them into model-visible diagnostics.
        detail = str(error) if isinstance(error, (ValueError, FileExistsError, TimeoutError)) else "Check relay connectivity or site access requirements"
        print(json.dumps({"error": type(error).__name__, "status": getattr(error, "code", None), "message": detail}), file=sys.stderr)
        sys.exit(1)
`
