# Agent Note: Keep meeting-skill transient files in the writable output directory

Status: implemented

English | [中文](2026-09-17-meeting-skill-transient-files.zh.md)

## Problem

The meeting-minutes skill created a temporary subdirectory below the requested output directory. Desktop workspace permissions allowed the output directory but could reject FFmpeg writes inside a directory created after the tool process started, so the normal skill entry point failed before transcription even though the ASR service was available. The workflow also exposed internal Markdown summaries and processing reports as user artifacts.

## Decision

Audio normalization and segmentation use unique transient files directly in the requested output directory and remove them after transcription. Meeting synthesis keeps its Markdown input transient and returns only the transcription text for audio tasks and the final Word document. The skill does not return Markdown, JSON, internal material summaries, or processing reports.

## Alternatives considered

**Request broader desktop permissions.** Rejected because ordinary skill execution should succeed with write access to the user-selected output directory and should not require an additional approval solely for internal files.

**Use the operating-system temporary directory.** Rejected because the desktop sandbox does not guarantee write access outside the selected workspace.

**Keep intermediate files for diagnostics.** Rejected because government-office users need the requested documents, while internal Markdown and JSON increase output clutter and are not required to diagnose a failed API request.

## Consequences

The output directory can briefly contain uniquely named WAV or Markdown files while processing runs. Successful and failed executions attempt to remove those files. Audio tasks expose a TXT transcript and a Word meeting record; text-only tasks expose only the Word meeting record. Runtime tests verify artifact kinds and transient-file cleanup without calling a live model.
