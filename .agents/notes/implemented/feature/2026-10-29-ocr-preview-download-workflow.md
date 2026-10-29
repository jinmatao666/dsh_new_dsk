# Agent Note: OCR preview, downloads and optional names

Status: implemented

English | [中文](2026-10-29-ocr-preview-download-workflow.zh.md)

## Problem

Users need to inspect selected documents before recognizing them, download all outputs where they review results, and find files by format. PDF output duplicates an input format that is already accepted, and unnamed tasks need a recognizable default.

## Decision

PNG/JPEG/WebP/BMP previews use browser file objects. PDF/TIFF previews use an authenticated, origin-checked local rendering endpoint with the existing upload/page limits. Rendering does not create a task or call a model. File and page selectors also retrieve user-owned saved inputs. A request revision and abort controller prevent an earlier response from replacing a later selection; expired sessions close the expanded view and clear materials.

Only the requested deliverable is published; raw recognition JSON and text remain private server evidence. Historical task lists also hide auxiliary artifacts. The workbench renders the deliverable as a download action using the existing native-save/browser-download path. The files page filters deliverable extensions and reports the filtered count through a keyboard-accessible custom listbox without a PDF option. TXT, Markdown, JSON, CSV and Word remain selectable outputs; historical PDF artifacts remain downloadable. Blank names use the first file stem and minute timestamp, with a China Standard Time server fallback and the existing 100-character limit.

## Alternatives considered

**Waiting for recognition to produce the first preview** prevents users from checking their selected pages before invoking the model.

**Embedding PDFs in a browser frame** depends on desktop webview PDF support and conflicts with the expert's restrictive frame policy; local PNG rendering keeps the same image viewer for every accepted document type.

**Only naming tasks in the browser** leaves direct API callers and browser failures with unnamed records. The server supplies the same fallback after validating filenames.

## Consequences

PDF/TIFF preview uploads are sent to the expert service before recognition and rendered there. Page changes can resend the encoded source, so large documents add transfer time; browser-side encoding is reused while the file remains selected. Preview and recognition remain independent. Removing PDF output leaves existing results intact and resets old PDF tasks to text when rerun through the workbench.

## Testing

Python integration tests verify preview without an inference service, absence of task creation/model calls, page and file selection, ownership, malformed input rejection, optional names, removed PDF output and Word export from PDF input. Browser checks exercise upload previews, PDF paging, file switching, expanded view, unnamed submission, direct Word download, filtering, empty states and mobile layout using explicit local HTTP fixtures.
