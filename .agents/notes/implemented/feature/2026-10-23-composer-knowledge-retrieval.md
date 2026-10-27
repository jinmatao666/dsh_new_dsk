# Agent Note: Composer knowledge retrieval feeds RAGFlow chunks to the Session model

Status: implemented

English | [中文](2026-10-23-composer-knowledge-retrieval.zh.md)

## Problem

Desktop users could ask questions against a knowledge library only on the knowledge page, where a RAGFlow chat assistant writes the answer. Ordinary conversations could not use library content, and users could not combine several libraries in one question.

## Decision

The composer tool row carries a 知识库 switch registered by `dsh-wanwei-knowledge-base` in `conversation.composer.tools`. Turning it on opens a picker whose groups come from the same `libraryNavGroups` function as the desktop sidebar, so the picker always shows the library types the sidebar shows. Users may select up to 20 libraries across groups. The selected ids for the current Session reach the Host through the `retrieval-scope` operation on `/desktop-knowledge-base`; a staged-Session transfer applies them to a Session created by a first send. Turning the switch off hides the picker and sends an empty scope.

`dsh-wanwei-oneapi-auth` keeps the scope in Host memory keyed by Session id and registers an `agent/pre-step` listener. On step 1 of a turn in a scoped Session it takes the newest `user`-source message text, calls OneAPI `POST /api/knowledge-bases/retrieval`, and appends one `notice` user message from `wanwei-knowledge-retrieval` with numbered chunks, file names, and library names. OneAPI checks every library with `GetAuthorizedKnowledgeBase`, calls RAGFlow `POST /api/v1/retrieval` with the mapped dataset ids, and drops chunks from datasets the caller did not request. The Session's own model writes the answer. Empty results and retrieval failures are logged as short statements so the model can tell the user, and the turn continues.

## Alternatives considered

**Answer through the RAGFlow chat assistant:** rejected because the answer would bypass the Session model, its tools, and its history, and each assistant is bound to one dataset.

**Prepend chunks to the user's message text in the browser:** rejected because the user's message would no longer be what the user typed, and the Client would need a submit interception point that does not exist.

**Keep the scope in a durable session event:** rejected because the scope is a UI choice that the toggle re-sends on every Session switch. The retrieved chunks, which the model does see, are logged.

## Consequences

The Host forgets scopes on restart; the toggle re-sends the scope when the composer mounts for the current Session. Retrieval adds latency to the first step of each scoped turn, bounded by `knowledgeRetrievalTimeoutMs`. The OneAPI build must ship `POST /api/knowledge-bases/retrieval` together with the desktop build. See [knowledge-answer citations](2026-10-22-knowledge-answer-citations.md) for the separate knowledge-page Q&A path.
