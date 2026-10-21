---
description: "Manage authorized RAGFlow datasets, documents and isolated knowledge conversations from the Wanwei desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-knowledge-base

English | [中文](README.zh.md)

## Summary

This Client plugin adds the administrator-controlled Knowledge Base entry. OneAPI owns authorization, local records and the RAGFlow credential; the browser receives only authorized knowledge-base metadata, document metadata, parsed preview text, downloadable file bytes, saved Q&A turns and answers.

## Use this package

Mount the plugin after `dsh-wanwei-oneapi-auth` and `dsh-wanwei-feature-panels`. Configure `RAGFLOW_BASE_URL` and `RAGFLOW_API_KEY` on the OneAPI server. Each new conversation creates an isolated RAGFlow chat assistant and session.

Personal knowledge bases are visible to their owner. Shared knowledge bases are visible to their owner and to user or department grants stored by OneAPI. Published common libraries are visible to every user under Subscription. Administrators see the full catalog in the workbench and on the desktop. Uploads are limited to 20 MB.

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
- Upload starts RAGFlow parsing asynchronously on the server; the desktop page does not expose manual re-parse. Selecting a content item highlights the row; the context menu offers only move, copy, and delete. Move and copy target personal or shared libraries and sync through OneAPI (download plus upload, then RAGFlow delete for move). Delete calls RAGFlow document deletion. Double-click opens a viewer: images and PDFs use the original file blob, plain text uses the downloaded bytes, and other types fall back to RAGFlow chunk text.
- The add-content menu uploads local files and local folders into the current library. Folder upload still stores each file in the library, and the content list groups them by relative path as a folder tree. Web links, notes, Tencent docs, recording minutes, personal-library import, and empty new folders are shown but not connected.
