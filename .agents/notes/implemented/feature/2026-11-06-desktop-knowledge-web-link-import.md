# Agent Note: Desktop knowledge web-link import

Status: implemented

English | [中文](2026-11-06-desktop-knowledge-web-link-import.zh.md)

## Problem

Personal desktop libraries could only add local files. Callers needed to paste public page URLs (WeChat articles, news, blogs) into a library so RAGFlow could crawl and parse them, with client-side format checks before the network call.

## Decision

The personal upload menu opens an 导入网页链接 dialog. The textarea accepts newline-separated absolute `http`/`https` URLs (max 10). `parseWebLinkInput` in `packages/wanwei/knowledge-base/src/client/web-links.ts` rejects empty input, over-count, non-http(s) schemes, credentials, and localhost/`.local` hosts via regex plus `URL` parsing. Valid URLs call `KnowledgeApi.importWebLinks` → OneAPI-auth RPC `import-web-links` → `POST /api/knowledge-bases/:id/web-links`. The controller re-validates; OneAPI fetches each public page over SSRF-safe dialing (`resourcerelay.DialPublic`), uploads the HTML/PDF bytes through RAGFlow's ordinary `POST .../documents` file field, records creators, and starts parse. Only uncategorized personal libraries may import.

## Alternatives considered

**Rely on RAGFlow `POST .../documents?type=web`.** Rejected for the deployed RAGFlow build: it ignores `type=web` and answers `No file part!`, so OneAPI must fetch and upload a local file.

**Fetch pages in the desktop process and upload as files.** Rejected; browser-side fetch fails CORS and skips server-side SSRF policy.

**Accept bare domains without a scheme and prepend `https://`.** Rejected; ambiguous input hides malformed lines and diverges from the server's absolute-URL check.

## Consequences

Web-link import shares the personal-only upload gate from [desktop knowledge upload personal-only](2026-11-06-desktop-knowledge-upload-personal-only.md). Invalid lines stay in the dialog with an inline error; successful import closes the dialog and refreshes the document list. HTML `<title>` becomes the stored name (`.html` kept for type detection, stripped on the card). Content cards poll `run`/`progress` and show `解析中…N% | HH:mm` until DONE; preview ask stays disabled until parse completes; HTML opens in a sandboxed iframe. Recording-minutes uses the same personal upload menu ([desktop knowledge recording minutes](2026-11-06-desktop-knowledge-recording-minutes.md)).
