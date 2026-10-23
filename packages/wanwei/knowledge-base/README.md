---
description: "Manage authorized RAGFlow datasets, documents and isolated knowledge conversations from the Wanwei desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-knowledge-base

English | [中文](README.zh.md)

## Summary

This Client plugin adds the administrator-controlled Knowledge Base entry. OneAPI owns authorization, local records and the RAGFlow credential; the browser receives only authorized knowledge-base metadata, document metadata, parsed preview text, downloadable file bytes, saved Q&A turns, answers and locatable citations.

## Use this package

Mount the plugin after `dsh-wanwei-oneapi-auth` and `dsh-wanwei-feature-panels`. Configure `RAGFLOW_BASE_URL` and `RAGFLOW_API_KEY` on the OneAPI server. Each new conversation creates an isolated RAGFlow chat assistant and session.

Personal knowledge bases are visible to their owner. Shared knowledge bases are visible to their owner and to user or department grants stored by OneAPI. Published common libraries are visible to every signed-in user. Workbench tabs are Personal plus each created category. The desktop sidebar shows Personal, non-empty open categories, and 订阅知识库 for every accessible library filed under an auth-required category; auth category names never appear as sidebar groups. Others discover those libraries in the Knowledge Plaza (which omits libraries the caller owns), subscribe, get approved on the workbench audit list, then see them under 订阅知识库. Administrators see the full catalog in the workbench and on the desktop. Uploads are limited to 20 MB.

## Model Experience

### Browser-owned knowledge conversation

#### What the model sees

RAGFlow receives the selected dataset, the user's question and the conversation's RAGFlow history. The Harness agent loop receives none of this content.

#### Token effect

Token use belongs to the RAGFlow assistant and its configured model.

#### KV Cache effect

Each knowledge conversation owns a distinct RAGFlow assistant and session, so cache reuse does not cross conversations.

## Known Limitations and Deferred Work

- The creation dialog does not yet expose user and department grant editing; the database and API accept grant records for the administration workflow.
- Upload starts RAGFlow parsing asynchronously on the server; the desktop page does not expose manual re-parse. Click opens a viewer; right-click selects and shows move, copy, and delete. Move and copy target personal or shared libraries and sync through OneAPI (download plus upload, then RAGFlow delete for move). Delete calls RAGFlow document deletion. Images use the original file blob; PDFs render with pdf.js so answer citations can highlight RAGFlow chunk boxes (quote text-layer search is the fallback); plain text uses downloaded bytes; other types fall back to RAGFlow chunk text. Finished answers replace `##i$$` / `[ID:i]` markers with blue numbered citations from those RAGFlow `reference` chunks; the page does not invent a separate source list.
- The add-content menu uploads local files and local folders into the current library. Folder upload still stores each file in the library, and the content list groups them by relative path as a folder tree. Web links, notes, Tencent docs, recording minutes, personal-library import, and empty new folders are shown but not connected.
