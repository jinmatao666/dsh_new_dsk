#!/usr/bin/env python3
"""
Migrate personal_skills.content into body + assets using fence rule.

Rule (per user 2026-05-06):
  - assets: every ```...``` fenced code block in content (fences included)
  - body:   everything else (text outside any fence)

Each fence block is stored as a raw string in a JSON array:
  ["```lang\\n...\\n```", "<!-- file: x.md -->\\n```md\\n...\\n```", ...]

If the line immediately above an opening fence is a `<!-- file: ... -->`
HTML comment, that comment line is folded into the same asset (and removed
from body).

Run modes:
  --dry-run                   No DB writes. Print per-row split summary.
  --apply                     Write body / assets / updated_at columns.
  --clear                     UPDATE body=NULL, assets=NULL, *_updated_at=0
                              for matched rows. Combine with --apply to commit.
  --table skills|personal_skills
  --names a,b,c               Only these names.
  --ids 1,2,3                 Only these ids.
  --all                       Process every row in the table.
  --limit N                   Cap rows processed (after filtering).

DB connection from env (defaults match local ssh tunnel):
  PARVIS_DB_HOST / PORT / USER / PASS / NAME
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

import pymysql
from pymysql.cursors import DictCursor

DB_HOST = os.environ.get("PARVIS_DB_HOST", "127.0.0.1")
DB_PORT = int(os.environ.get("PARVIS_DB_PORT", "3306"))
DB_USER = os.environ.get("PARVIS_DB_USER", "root")
DB_PASS = os.environ.get("PARVIS_DB_PASS", "one_api_root_2024")
DB_NAME = os.environ.get("PARVIS_DB_NAME", "oneapi")

FENCE_OPEN_RE = re.compile(r"(?m)\A[ \t\r\n]*```[\w+-]*\r?\n")
FENCE_CLOSE_RE = re.compile(r"(?m)^[ \t]*```[ \t]*\r?$")
SCRIPT_MARKER_RE = re.compile(r"(?m)^#{1,6}[ \t]*Script:[ \t]*(\S+)[ \t]*\r?\n")
FILE_MARKER_RE = re.compile(r"(?m)^<!--[ \t]*file:[ \t]*([^\n>]+?)[ \t]*-->[ \t]*\r?\n")


def split_content(content: str) -> tuple[str, str]:
    """Carve marker+fence blocks out of content -> (body, assets).

    Mirrors packages/opencode/src/skill/assets.ts:parse:
      1. Locate every `## Script: <path>` or `<!-- file: <path> -->` header.
      2. For each header, the next non-blank text must be a ``` fence;
         otherwise the marker stays in body.
      3. The block runs until the next marker (or end), terminated by the
         LAST bare ``` line within that span (so inner fences in the
         attachment body survive).

    body   = content with every successfully-parsed asset span removed.
    assets = the verbatim concatenation of those spans, separated by `\\n\\n`.
    """
    markers: list[tuple[int, int, str]] = []
    for rx in (SCRIPT_MARKER_RE, FILE_MARKER_RE):
        for m in rx.finditer(content):
            markers.append((m.start(), m.end(), m.group(1).strip()))
    markers.sort(key=lambda t: t[0])

    asset_spans: list[tuple[int, int]] = []
    asset_texts: list[str] = []

    for i, (header_start, after_header, _path) in enumerate(markers):
        next_start = markers[i + 1][0] if i + 1 < len(markers) else len(content)
        span_after_header = content[after_header:next_start]

        fence = FENCE_OPEN_RE.match(span_after_header)
        if not fence:
            continue
        code_start = after_header + fence.end()
        code_region = content[code_start:next_start]
        closes = list(FENCE_CLOSE_RE.finditer(code_region))
        if not closes:
            continue
        last_close = closes[-1]
        block_end = code_start + last_close.end()
        asset_spans.append((header_start, block_end))
        asset_texts.append(content[header_start:block_end].rstrip("\r\n"))

    if not asset_spans:
        body = content.rstrip()
        if body:
            body += "\n"
        return body, ""

    body_parts: list[str] = []
    cursor = 0
    for start, end in asset_spans:
        body_parts.append(content[cursor:start])
        cursor = end
    body_parts.append(content[cursor:])
    body = "".join(body_parts)
    body = re.sub(r"\n{3,}", "\n\n", body).rstrip()
    if body:
        body += "\n"

    assets = "\n\n".join(asset_texts)
    if assets:
        assets += "\n"
    return body, assets


def parse_csv(s):
    return [x.strip() for x in s.split(",") if x.strip()] if s else []


def parse_csv_int(s):
    return [int(x) for x in parse_csv(s)]


def fetch_rows(conn, table, *, names, ids, all_rows, limit):
    where = []
    params = []
    if names:
        where.append("name IN (" + ",".join(["%s"] * len(names)) + ")")
        params.extend(names)
    if ids:
        where.append("id IN (" + ",".join(["%s"] * len(ids)) + ")")
        params.extend(ids)
    if not where and not all_rows:
        raise SystemExit("must pass --names, --ids or --all")
    sql = f"SELECT id, name, content FROM {table}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def main():
    p = argparse.ArgumentParser(description="Carve content into body + assets by fence blocks.")
    p.add_argument("--table", default="personal_skills",
                   choices=["skills", "personal_skills"])
    p.add_argument("--all", action="store_true")
    p.add_argument("--names")
    p.add_argument("--ids")
    p.add_argument("--limit", type=int)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    p.add_argument("--clear", action="store_true",
                   help="Reset body / assets / *_updated_at to NULL/0. Combine with --apply to commit.")
    args = p.parse_args()

    names = parse_csv(args.names)
    ids = parse_csv_int(args.ids)

    conn = pymysql.connect(
        host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASS,
        database=DB_NAME, charset="utf8mb4", cursorclass=DictCursor,
        autocommit=False,
    )
    try:
        rows = fetch_rows(conn, args.table,
                          names=names or None, ids=ids or None,
                          all_rows=args.all, limit=args.limit)
        if not rows:
            print("(no rows matched)")
            return 0

        if args.clear:
            ids_list = [r["id"] for r in rows]
            print(f"[clear] {len(ids_list)} rows: ids={ids_list}")
            if args.apply:
                with conn.cursor() as cur:
                    placeholders = ",".join(["%s"] * len(ids_list))
                    cur.execute(
                        f"UPDATE {args.table} SET body=NULL, assets=NULL, "
                        f"body_updated_at=0, assets_updated_at=0 "
                        f"WHERE id IN ({placeholders})",
                        ids_list,
                    )
                conn.commit()
                print(f"[clear] committed reset on {len(ids_list)} rows")
            else:
                print("[clear] dry-run, no commit")
            return 0

        now = int(time.time())
        total_assets = 0
        for r in rows:
            content = r["content"] or ""
            body, assets = split_content(content)
            print(
                f"id={r['id']:<5} name={r['name']:<32} "
                f"clen={len(content):<7} -> body={len(body):<6} + "
                f"assets={len(assets)} chars"
            )
            if args.apply:
                with conn.cursor() as cur:
                    cur.execute(
                        f"UPDATE {args.table} SET body=%s, assets=%s, "
                        f"body_updated_at=%s, assets_updated_at=%s WHERE id=%s",
                        (body, assets, now, now, r["id"]),
                    )
            total_assets += 1 if assets else 0

        if args.apply:
            conn.commit()
            print(f"\ncommitted: {len(rows)} rows, {total_assets} with assets")
        else:
            conn.rollback()
            print(f"\ndry-run: {len(rows)} rows scanned, {total_assets} would have non-empty assets")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
