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

Rebuild the product UI and native shell together. DOC and PPT still require LibreOffice or SOFFICE_PATH; modern Office formats render directly. The tree checks changes every three seconds while visible. Search is bounded to 150 directories and 5000 results; file reads are bounded to 24 MiB. Drafts are memory-resident rather than durable across application exits. Explicit model edits consume normal model usage.

Browser checks cover Word, merged/multiple worksheet previews, Markdown, sanitized HTML, image zoom, slides and continuous PDF pages. Focused tests cover request correlation, cross-run Word replacement, draft switching, resource boundaries, path constraints, conflict rejection and recoverable file operations. These checks do not assert pixel equality for every user file or replace real-provider testing in the rebuilt desktop shell. See the product preview-runtime README for host adapters and the reproduction command.

The panel is scoped to the selected session workspace and stays absent without one. Its Lucide controls replace text glyphs; closing the preview retains the file tree. Wide windows dock the panels while preserving conversation width; smaller windows use a file-list popover or overlay. XLS and UTF-8 CSV render directly; JSON and projection files use text previews. Other formats offer native system opening and, on Windows, an application chooser after an opening error. A compatible installed application is still required for external viewing.

Keep the upstream turn-tail collected-files row. Remove the generic file-card presenter so it no longer claims and hides ordinary chips. A product-owned capture listener forwards collected-file clicks to the bounded active-workspace preview and leaves the existing opener untouched when no workspace accepts the path. External opening stays in the preview toolbar; the specialized analysis presenter remains separate. Integration tests render the actual upstream ProducedFiles component and verify multi-file switching, opening a closed pane, native app opening, outside-workspace fallback and absence of duplicate cards.
