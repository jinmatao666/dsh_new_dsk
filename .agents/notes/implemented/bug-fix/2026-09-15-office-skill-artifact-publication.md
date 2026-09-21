# Agent Note: Office skill artifact publication

Status: implemented

English | [中文](2026-09-15-office-skill-artifact-publication.zh.md)

## Problem

Office skills generated useful final files alongside extraction indexes, rollback data, and processing reports. Publishing every path made internal Markdown and JSON files compete with the document, PDF, or image that the user requested. A failed runtime result could also be scanned as ordinary terminal prose, causing input and diagnostic paths to appear as successful deliverables.

## Decision

The `WANWEI_RESULT` marker is the authoritative source of terminal office-skill deliverables. A valid marker with `success: false` publishes no files, and a valid marker is never passed through the generic terminal-path fallback.

Office runtimes place only files intended for the user in `artifacts`. Temporary extraction files and recovery metadata use separate result fields and do not appear in the produced-files row. Skills choose deliverables for their task: document comparison publishes Word and HTML, document summary publishes Word, applied batch rename publishes renamed files, and image processing publishes processed images.

## Alternatives considered

**Infer the important files from extensions in the client.** Extension rules cannot know whether a JSON file is a requested analysis result or internal recovery state, and they would encode individual skill policy in the desktop client.

**Let the model name the final files in its closing response.** Model prose is not a reliable record of tool output and can omit, reorder, or misclassify files that the runtime created.

**Publish every runtime file and rely on descriptions.** This keeps internal implementation files visible to users and leaves the primary deliverable hidden behind overflow controls.

## Consequences

The produced-files row presents the requested office output without internal Markdown or JSON clutter. Each office skill remains responsible for its own artifact selection, while the client applies one generic marker rule instead of hardcoding skill names. Internal recovery files remain available to the runtime but are not advertised as user deliverables.
