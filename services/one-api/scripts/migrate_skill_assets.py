#!/usr/bin/env python3
"""
Migrate skills.Content into Body + Assets.

Plan reference: docs/plans/2026-05-06-skill-assets-separation-and-local-sync.md §4.

For each skill row:
  1. Scan Content for two recognised attachment formats:
       a) "## Script: <relpath>\n\n```<lang>\n<code>\n```"   (majority)
       b) "<!-- file: <relpath> -->\n```<lang>\n<code>\n```" (anthropic-style)
  2. Carve those blocks out -> Body (plus any markdown lead-in immediately
     above each block - ## headers and trailing blank lines are trimmed too).
  3. Remaining matched code becomes Assets[]:
        [{path, encoding: "utf-8", content, executable}]
     executable = path ends in .py / .sh
  4. Write Body, Assets, body_updated_at = assets_updated_at = now() to
     skills (or personal_skills). Content is preserved untouched.

Run modes:
  --dry-run               No DB writes. Print per-skill summary + first 200 chars
                          of body and per-asset path/length.
  --apply                 Real writes (UPDATE).
  --table skills|personal_skills
  --names a,b,c           Only these skill names.
  --ids 1,2,3             Only these ids.
  --all                   Process every row in the table.
  --limit N               Cap how many rows to touch (after filtering).

Safety:
  - Refuses to run --apply unless --i-have-backed-up is also passed
    OR --names / --ids is provided (small-batch carve-out).
  - Always uses transactions; rollback on any per-row exception.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Iterable, Sequence

import pymysql
from pymysql.cursors import DictCursor

# --- DB connection ---------------------------------------------------------

DB_HOST = os.environ.get("PARVIS_DB_HOST", "127.0.0.1")
DB_PORT = int(os.environ.get("PARVIS_DB_PORT", "3306"))
DB_USER = os.environ.get("PARVIS_DB_USER", "root")
DB_PASS = os.environ.get("PARVIS_DB_PASS", "one_api_root_2024")
DB_NAME = os.environ.get("PARVIS_DB_NAME", "oneapi")

# --- regex patterns --------------------------------------------------------

EXECUTABLE_EXTS = {".py", ".sh"}

# Header-only patterns. We walk the content marker-by-marker so that asset
# bodies which themselves contain ``` fences (markdown READMEs, shell scripts
# echoing fenced examples) are not truncated at the first inner fence.
SCRIPT_MARKER_RE = re.compile(
    r"(?m)^(?P<head>\#{1,6}[ \t]*Script:[ \t]*(?P<path>\S+)[ \t]*)\r?\n",
)
FILE_MARKER_RE = re.compile(
    r"(?m)^(?P<head><!--\s*file:\s*(?P<path>[^\n>]+?)\s*-->)\s*\r?\n",
)
FENCE_OPEN_RE = re.compile(r"\A[ \t]*```([\w+-]*)\r?\n", re.M)


# --- splitter --------------------------------------------------------------


def _ext(path: str) -> str:
    i = path.rfind(".")
    return path[i:].lower() if i >= 0 else ""


def _find_markers(content: str) -> list[dict]:
    """Return marker dicts sorted by start position.

    Each marker carries its header span, the path, and the position right
    after the header line where we expect an opening ``` fence.
    """
    markers: list[dict] = []
    for rx in (SCRIPT_MARKER_RE, FILE_MARKER_RE):
        for m in rx.finditer(content):
            markers.append({
                "header_start": m.start(),
                "after_header": m.end(),
                "path": m.group("path").strip(),
            })
    markers.sort(key=lambda d: d["header_start"])
    return markers


def split_content(content: str) -> tuple[str, list[dict]]:
    """Carve attachment blocks out of ``content`` -> (body, assets).

    Strategy:
      1. Locate every Script:/file: header line.
      2. For each header, the next non-blank text must be ``` (an opening
         fence). If it's not, the marker is left in the body untouched.
      3. The block runs until the next marker - or end of content - and is
         expected to be terminated by a line that is exactly ``` followed by
         optional whitespace. We use the LAST such line within the span,
         not the first, so nested fences inside the asset survive.
    """
    markers = _find_markers(content)
    if not markers:
        return content, []

    body_parts: list[str] = []
    assets: list[dict] = []
    seen_paths: set[str] = set()
    cursor = 0

    for i, mk in enumerate(markers):
        next_start = markers[i + 1]["header_start"] if i + 1 < len(markers) else len(content)
        span_after_header = content[mk["after_header"]:next_start]

        fence = FENCE_OPEN_RE.match(span_after_header)
        if not fence:
            # No opening fence after the header - leave it in body verbatim.
            continue

        code_start = mk["after_header"] + fence.end()
        code_region = content[code_start:next_start]
        # Find the LAST line that is a bare closing fence.
        closing_iter = list(re.finditer(r"(?m)^[ \t]*```[ \t]*\r?$", code_region))
        if not closing_iter:
            # Malformed block - leave header in body, don't carve.
            continue
        closing = closing_iter[-1]
        code = code_region[:closing.start()].rstrip("\r\n")
        block_end = code_start + closing.end()

        # Body keeps everything up to (but not including) the header line.
        body_parts.append(content[cursor:mk["header_start"]])
        cursor = block_end

        if mk["path"] in seen_paths:
            continue
        seen_paths.add(mk["path"])
        assets.append({
            "path": mk["path"],
            "encoding": "utf-8",
            "content": code,
            "executable": _ext(mk["path"]) in EXECUTABLE_EXTS,
        })

    body_parts.append(content[cursor:])
    body = "".join(body_parts)
    body = re.sub(r"\n{3,}", "\n\n", body).rstrip() + "\n"
    return body, assets


# --- DB ops ----------------------------------------------------------------


def fetch_rows(conn, table: str, *, names: Sequence[str] | None,
               ids: Sequence[int] | None, all_rows: bool,
               limit: int | None) -> list[dict]:
    where_parts: list[str] = []
    params: list = []
    if names:
        where_parts.append("name IN (" + ",".join(["%s"] * len(names)) + ")")
        params.extend(names)
    if ids:
        where_parts.append("id IN (" + ",".join(["%s"] * len(ids)) + ")")
        params.extend(ids)
    if not where_parts and not all_rows:
        raise SystemExit("must pass --names, --ids or --all")
    where = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    sql = f"SELECT id, name, content, body, body_updated_at, assets_updated_at FROM {table} {where} ORDER BY id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def write_back(conn, table: str, row_id: int, body: str,
               assets_json: str, ts: int) -> None:
    sql = (
        f"UPDATE {table} SET body=%s, assets=%s, "
        f"body_updated_at=%s, assets_updated_at=%s WHERE id=%s"
    )
    with conn.cursor() as cur:
        cur.execute(sql, (body, assets_json, ts, ts, row_id))


# --- CLI -------------------------------------------------------------------


def parse_csv(s: str | None) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()] if s else []


def parse_csv_int(s: str | None) -> list[int]:
    return [int(x) for x in parse_csv(s)]


def main() -> int:
    p = argparse.ArgumentParser(description="Carve skills.Content into Body + Assets.")
    p.add_argument("--table", default="skills",
                   choices=["skills", "personal_skills"])
    g = p.add_mutually_exclusive_group(required=False)
    g.add_argument("--all", action="store_true",
                   help="Process every row in the table.")
    p.add_argument("--names", help="Comma-separated skill names.")
    p.add_argument("--ids", help="Comma-separated skill ids.")
    p.add_argument("--limit", type=int)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    p.add_argument("--i-have-backed-up", action="store_true",
                   help="Required for --apply --all.")
    p.add_argument("--show-body-chars", type=int, default=200,
                   help="Body preview length in dry-run output.")
    args = p.parse_args()

    names = parse_csv(args.names)
    ids = parse_csv_int(args.ids)

    if args.apply and args.all and not args.i_have_backed_up:
        sys.stderr.write(
            "refusing --apply --all without --i-have-backed-up\n"
            "Take a backup first:\n"
            "  ssh front-end-2 \"docker exec one-api-mysql mysqldump -uroot -p... oneapi skills personal_skills\" > backups/...\n"
        )
        return 2

    conn = pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS,
        database=DB_NAME, charset="utf8mb4", cursorclass=DictCursor,
        autocommit=False,
    )
    try:
        rows = fetch_rows(
            conn, args.table,
            names=names or None, ids=ids or None,
            all_rows=args.all, limit=args.limit,
        )
        if not rows:
            print("(no rows matched)")
            return 0

        now = int(time.time())
        total_assets = 0
        total_body_delta = 0
        skipped_no_match = 0
        skipped_already_done = 0

        for r in rows:
            content: str = r["content"] or ""
            body, assets = split_content(content)

            if r["body"] and r["body_updated_at"]:
                # Idempotency guard: don't overwrite an already-migrated row.
                skipped_already_done += 1
                print(f"[skip migrated] id={r['id']:<5} name={r['name']}")
                continue

            if not assets:
                skipped_no_match += 1
                # Still write body=content as a no-op so that body_updated_at
                # exists (otherwise the client sync will keep diffing it).
                if args.apply:
                    write_back(conn, args.table, r["id"], content,
                               json.dumps([]), now)
                print(f"[no-attach]   id={r['id']:<5} name={r['name']:<30} "
                      f"clen={len(content)}")
                continue

            assets_json = json.dumps(assets, ensure_ascii=False)
            print(f"[ok]          id={r['id']:<5} name={r['name']:<30} "
                  f"clen={len(content)} -> body={len(body)} + "
                  f"{len(assets)} assets({sum(len(a['content']) for a in assets)} chars)")
            for a in assets:
                exe = " *" if a["executable"] else "  "
                print(f"               {exe} {a['path']:<60} {len(a['content'])} chars")

            if args.dry_run:
                preview = body[: args.show_body_chars].replace("\n", " | ")
                print(f"               body[:{args.show_body_chars}]: {preview}")
                # Sanity check: body must not contain any leftover script header
                leftover_script = SCRIPT_MARKER_RE.search(body)
                leftover_file = FILE_MARKER_RE.search(body)
                if leftover_script or leftover_file:
                    print(f"               !! leftover attachment header in body")
            else:
                write_back(conn, args.table, r["id"], body, assets_json, now)

            total_assets += len(assets)
            total_body_delta += len(content) - len(body)

        if args.apply:
            conn.commit()
            print(f"\ncommitted: {len(rows) - skipped_already_done} rows, "
                  f"{total_assets} assets, body shrank by {total_body_delta} chars")
        else:
            conn.rollback()
            print(f"\ndry-run: {len(rows)} rows scanned, "
                  f"{skipped_no_match} no-attach, "
                  f"{skipped_already_done} already migrated, "
                  f"{total_assets} assets would be written")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
