---
description: "Manage authorized RAGFlow datasets, documents and isolated knowledge conversations from the Wanwei desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-knowledge-base

English | [中文](README.zh.md)

## Summary

This Client plugin adds the administrator-controlled Knowledge Base entry. OneAPI owns authorization, local records and the RAGFlow credential; the browser receives only authorized knowledge-base metadata, document metadata, parsed preview text, downloadable file bytes, saved Q&A turns, answers and locatable citations.

## Use this package

Mount the plugin after `dsh-wanwei-oneapi-auth` and `dsh-wanwei-feature-panels`. Configure `RAGFLOW_BASE_URL` and `RAGFLOW_API_KEY` on the OneAPI server. Each new conversation creates an isolated RAGFlow chat assistant and session. The knowledge Q&A pane clears the caller's saved turns for the open library by replacing that RAGFlow session.

Personal knowledge bases are visible to their owner; administrators also see every uncategorized personal library on the desktop. Shared knowledge bases are visible to their owner and to user or department grants stored by OneAPI. Published common libraries are visible to every signed-in user. Workbench tabs are Personal plus each created category. The desktop sidebar always shows Personal and 订阅知识库 (empty groups show 暂无知识库); 公共知识库 merges every open (non-auth) library and appears only when non-empty; 订阅知识库 lists only grant-backed subscriptions after approval (not self-built libraries). Auth category names never appear as sidebar groups. Auth libraries are discovered through the sidebar's Knowledge Plaza resource card; the plaza uses the Expert and Skill catalog visual system for its resource-center header, image-led cards, status badges, and responsive detail. Self-built auth libraries appear on the plaza with status 我的, sorted after other cards, with the same Q&A and file-open capability as 已订阅, and stay out of the sidebar subscription group. After workbench approval, other libraries remain on the plaza (with subscriber count) and also appear under 订阅知识库. Plaza detail is split: left keeps catalog and subscribe status, right is knowledge Q&A; approved or owned file rows open the same viewer as the content list. Opening a granted (non-owned) library offers 取消订阅; owned libraries never show that control. Uploads are limited to 20 MB. The workbench create and edit dialogs can attach, replace, or clear an optional cover image. The desktop create dialog does not show cover upload yet. Plaza cards and the plaza detail use the stored cover, and use the staged natural-resources photo when the library has none. On the create dialog, any signed-in user may either create a blank RAGFlow dataset or bind one already listed at `{RAGFLOW_BASE_URL}/api/v1/datasets` (the same origin as the RAGFlow datasets UI); datasets already linked to a local library are omitted from the picker.

The desktop page keeps Q&A closed by default so the content pane fills the width. Each sidebar library card shows its name, description, maintainer, update time, file count, and file size, without the cover image, category, ownership badges, or subscriber count; a chat icon button in the card's top-right corner opens or closes that library's Q&A pane and shows a highlighted pressed state while open; with Q&A open the file list shows one column, and no draggable divider exists. A search box above the sidebar groups filters libraries by name and expands matching groups. The content toolbar has a file-name search and a newest/oldest upload-time sort; the list paginates by top-level folder or file (12 per page) with a skill-market-style pager (page count, numbered pages, jump) pinned under the scrolling file list, and each file card shows its upload time and its creator. OneAPI records the creator when a file is uploaded or copied into a library; the creator is omitted for the caller's own files and for files uploaded before creators were recorded.

The composer tool row carries a 知识库 switch. Turning it on opens a picker that groups libraries exactly like the desktop sidebar (Personal, 公共知识库, 订阅知识库) and accepts up to 20 libraries across groups. The plugin sends the selection for the current Session to the Host with the `retrieval-scope` operation and transfers it to a Session created by a first send. Turning the switch off hides the picker and clears the Session scope, so later turns run unchanged. The switch is hidden when the deployment hides knowledge libraries on the current network.

## Model Experience

### Composer knowledge retrieval

#### What the model sees

When the current Session has a library scope, the `dsh-wanwei-oneapi-auth` Host plugin retrieves chunks for the user's question through OneAPI `POST /api/knowledge-bases/retrieval` (RAGFlow `POST /api/v1/retrieval`) before the first step of each user turn. It logs one `notice` user message from `wanwei-knowledge-retrieval` after the question with the numbered chunks, their file and library names, and an instruction to cite sources. An empty result or a retrieval failure is logged as a short statement instead. The Session's own model writes the answer; RAGFlow chat assistants are not involved.

#### Token effect

Each scoped user turn adds up to `knowledgeRetrievalMaxChars` characters of chunk text plus a fixed instruction. Turns without a scope add nothing.

#### KV Cache effect

The retrieval message is appended after the user message, so the prefix before the turn stays cacheable.

### Browser-owned knowledge conversation

#### What the model sees

RAGFlow receives the selected dataset, the user's question and the conversation's RAGFlow history. The Harness agent loop receives none of this content. Before CreateChat or UpdateChat, OneAPI checks whether the dataset already has retrieval chunks: still-parsing targets return `文件正在解析，请稍后重试`, and datasets with zero chunks (including DONE files that produced none) return `知识库尚无可检索内容，请等待文件解析完成后再试`, both as normal answers instead of the RAGFlow gateway error `doesn't own parsed file`. Finished answers show up to three related prompts (with a trailing question mark) and brand the assistant as 万维Buddy beside the logo.

#### Token effect

Token use belongs to the RAGFlow assistant and its configured model.

#### KV Cache effect

Each knowledge conversation owns a distinct RAGFlow assistant and session, so cache reuse does not cross conversations.

## Known Limitations and Deferred Work

- The creation dialog does not yet expose user and department grant editing; the database and API accept grant records for the administration workflow.
- Cover upload is on the workbench create and edit dialogs only. The desktop create dialog does not show it yet; the desktop still displays a stored cover on the plaza and the open library header.
- Upload starts RAGFlow parsing asynchronously on the server; the desktop page does not expose manual re-parse. Click opens a viewer; right-click selects and shows move, copy, and delete. Move and copy target personal or shared libraries and sync through OneAPI (download plus upload, then RAGFlow delete for move). Delete calls RAGFlow document deletion. Images use the original file blob; PDFs render with pdf.js so answer citations can highlight RAGFlow chunk boxes (quote text-layer search is the fallback). Downloads use a binary Fetch route instead of JSON byte arrays. Plain text uses downloaded bytes; other types fall back to RAGFlow chunk text. Finished answers replace `##i$$` / `#i$` / `[ID:i]` markers with blue numbered citations from those RAGFlow `reference` chunks; the page does not invent a separate source list.
- The add-content menu uploads local files into the current library. The local-folder entry is hidden for now (pagination counts top-level folders or files, so a whole-folder upload packs many files into one page slot). Web links, notes, Tencent docs, recording minutes, and personal-library import are shown but not connected; the empty-new-folder entry is hidden for now. Existing relative paths still render as a folder tree.
