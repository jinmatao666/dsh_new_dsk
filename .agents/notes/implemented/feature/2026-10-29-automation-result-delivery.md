# Agent Note: Automation result delivery

Status: implemented

English | [中文](2026-10-29-automation-result-delivery.zh.md)

## Problem

Selecting a connector tool did not guarantee delivery of scheduled task results. Users need persistent delivery switches without adding send instructions to each prompt.

## Decision

Tasks persist optional `pushChannels`, off by default. The editor replaces connector selection with independent delivery switches in a dropdown beside access permissions. Unconnected channels open the existing authorization panels above the preserved draft. The Host closes the execution record, saves its final text and per-channel delivery states, then sends without another model request. Execution status remains independent of delivery failure. Retry sends failed channels only and does not rerun the task. CLI deliveries use stable per-run and part keys; WeChat retries can duplicate an ambiguously accepted message because its transport has no idempotency key.

This partially supersedes the automation tool-selection decision in [Feishu connector automation](2026-10-24-feishu-connector-automation.md). That record retains the independent CLI authorization, skills and bidirectional conversation decisions. Legacy selections do not opt users into outbound delivery.

## Alternatives considered

**Prompt-only sending.** Rejected because model omissions, tool permissions and business failures make result delivery uncertain.

**Rerun on delivery failure.** Rejected because task side effects may repeat.

## Consequences

Feishu sends as the bot to the authenticated owner; DingTalk resolves self by stable ID and sends under personal authorization; WeChat requires a valid bound inbound reply context. Results are split into bounded ordered text messages, with desktop artifact paths rather than uploaded attachments. Interrupted pending deliveries become failed for explicit retry. Local scheduling still requires the desktop to run.

## Verification

Focused tests exercise real Loader/Session execution with mocked delivery transports, independent failure and retry, off-by-default switches, preserved authorization drafts, recipient resolution and multipart text.
