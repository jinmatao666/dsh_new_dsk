# Agent Note: File delivery preserves the answer

Status: implemented

English | [中文](2026-10-15-file-delivery-preserves-answer.zh.md)

## Problem

A prompt-generation task completed its text answer after running a local script. The final-file plugin inferred file output from shell execution and steered another request at turn stopping. The model declared an empty file list and returned an acknowledgement; the conversation folded the completed answer into the process disclosure.

## Decision

The file-delivery plugin registers verified replacement-style file lists without a turn-stopping listener. The model receives guidance to complete declarations before the final answer and preserve requested text results. Empty declarations remain valid and affect only file delivery. Shell execution is not evidence of a final file. The ordinary conversation answer projection remains unchanged; this fix prevents the plugin from creating a later answer solely for file bookkeeping.

## Alternatives considered

**Keep a stronger stopping reminder.** A reminder after a completed answer still creates another model request and makes that answer intermediate, regardless of the reminder wording.

**Special-case the private delivery tool in official chat projection.** This couples general answer selection to a private tool and can hide later substantive replies. The initiating plugin removes its forced continuation instead.

## Consequences

Files retain existence verification, identity deduplication, failure handling and empty-list clearing. A model that omits a required file declaration is not forced to retry after its answer; declaration accuracy still needs installed-desktop acceptance. Loader-composed regression coverage verifies empty and populated declarations, invalid files, no steering after shell or file work, prompt text and disposal. Existing logs are not rewritten.
