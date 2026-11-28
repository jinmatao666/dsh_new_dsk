# Agent Note: Buddy workspace file preview

Status: implemented

English | [中文](2026-11-28-buddy-workspace-preview.zh.md)

## Problem

Buddy needs the Parvis workspace file workflow while keeping upstream UI packages independently upgradeable.

## Decision

Keep workspace orchestration in the Wanwei React overlay and bounded filesystem commands in the product native shell. Run the original Parvis Solid preview components in an isolated iframe with local adapters, bundled styles and offline PDF assets. The source license ships inside the runtime. Word, PDF, worksheets, slides, images and selection behavior use the original renderers. Markdown and HTML receive local rendering/sandbox adapters; document-local images and stylesheets are embedded by the privileged owner.

The file tree uses Parvis artwork and supports expansion, search, pointer drag references, file operations and opened-file switching. Independent drafts survive workspace switches in memory. Word selection replacements preserve formatting across runs. Model transforms and Word chart insertion use the active session, correlate its request with the completed response, and produce reviewable drafts. Saving checks the original digest and atomically replaces the file. Deletion moves content into a hidden workspace .buddy-trash folder.

## Alternatives considered

Simplified React Office renderers lost merges, styles, slides and selection behavior. Importing the whole Parvis application would couple Buddy to its backend and session system. An isolated product-owned renderer preserves the relevant implementation without modifying upstream packages.

## Consequences

Rebuild the product UI and native shell together. DOC, XLS and PPT still require LibreOffice or SOFFICE_PATH; modern Office formats render directly. The tree checks changes every three seconds while visible. Search is bounded to 150 directories and 5000 results; file reads are bounded to 24 MiB. Drafts are memory-resident rather than durable across application exits. Explicit model edits consume normal model usage.

Browser checks cover Word, merged/multiple worksheet previews, Markdown, sanitized HTML, image zoom, slides and continuous PDF pages. Focused tests cover request correlation, cross-run Word replacement, draft switching, resource boundaries, path constraints, conflict rejection and recoverable file operations. These checks do not assert pixel equality for every user file or replace real-provider testing in the rebuilt desktop shell. See the product preview-runtime README for host adapters and the reproduction command.
