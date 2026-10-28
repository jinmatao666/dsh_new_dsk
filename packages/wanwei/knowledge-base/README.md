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

Personal knowledge bases are visible to their owner; administrators also see every uncategorized personal library on the desktop. Shared knowledge bases are visible to their owner and to user or department grants stored by OneAPI. Published common libraries are visible to every signed-in user. Workbench tabs are Personal plus each created category. The desktop sidebar always shows Personal; 公共知识库 merges every open (non-auth) library and appears only when non-empty; 订阅知识库 holds grant-backed auth-category libraries and appears only when non-empty. Auth category names never appear as sidebar groups. Auth-required libraries are discovered in the Knowledge Plaza; after workbench approval they appear under 订阅知识库. Opening a subscribed library offers 取消订阅 so it returns to the plaza. Uploads are limited to 20 MB.

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

RAGFlow receives the selected dataset, the user's question and the conversation's RAGFlow history. The Harness agent loop receives none of this content.

#### Token effect

Token use belongs to the RAGFlow assistant and its configured model.

#### KV Cache effect

Each knowledge conversation owns a distinct RAGFlow assistant and session, so cache reuse does not cross conversations.

## Known Limitations and Deferred Work

- The creation dialog does not yet expose user and department grant editing; the database and API accept grant records for the administration workflow.
- Upload starts RAGFlow parsing asynchronously on the server; the desktop page does not expose manual re-parse. Click opens a viewer; right-click selects and shows move, copy, and delete. Move and copy target personal or shared libraries and sync through OneAPI (download plus upload, then RAGFlow delete for move). Delete calls RAGFlow document deletion. Images use the original file blob; PDFs render with pdf.js so answer citations can highlight RAGFlow chunk boxes (quote text-layer search is the fallback). Downloads use a binary Fetch route instead of JSON byte arrays. Plain text uses downloaded bytes; other types fall back to RAGFlow chunk text. Finished answers replace `##i$$` / `[ID:i]` markers with blue numbered citations from those RAGFlow `reference` chunks; the page does not invent a separate source list.
- The add-content menu uploads local files and local folders into the current library. Folder upload still stores each file in the library, and the content list groups them by relative path as a folder tree. Web links, notes, Tencent docs, recording minutes, personal-library import, and empty new folders are shown but not connected.
