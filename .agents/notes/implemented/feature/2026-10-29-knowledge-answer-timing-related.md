# Agent Note: Knowledge answer timing and related questions

Status: implemented

English | [中文](2026-10-29-knowledge-answer-timing-related.zh.md)

## Problem

Desktop knowledge Q&A finished without showing when the turn started or ended, how long it took, or a fixed set of follow-up prompts under the answer.

## Decision

Record `startedAt` / `endedAt` on each assistant turn in the knowledge page and render one timing line after a finished answer. Cap related questions at three unique non-empty strings labeled 推荐关联问题, on both the desktop client and OneAPI recommendation payload, and append `？` when a prompt has no trailing `?` / `？`. OneAPI `Recommend` tries `/api/v1/sessions/related_questions`, then `/api/v1/chat/recommendation`, then the legacy misspelling `/api/v1/chat/recommandation`, because the deployment still serves only the sessions path and the single old misspelled chat path returned NotFound (empty recommendations, UI hidden).

## Alternatives considered

Persisting timing into RAGFlow session history — rejected; history reload does not need wall-clock metadata for this product request, and session storage is owned by RAGFlow. Calling only `/api/v1/chat/recommendation` — rejected until every deployment drops the sessions route.

## Consequences

Current-session answers show timing and up to three related questions ending in a question mark; reloaded history still omits timing because messages come from RAGFlow without those fields. A Recommend route miss no longer silently blanks the footer when an older alias still works.

## Required verification

Ask a question in the desktop knowledge panel and confirm the timing line plus at most three related-question buttons (each with a trailing question mark) appear under the finished answer.
