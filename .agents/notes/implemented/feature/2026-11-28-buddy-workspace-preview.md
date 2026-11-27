# Agent Note: Buddy workspace file preview

English | [中文](2026-11-28-buddy-workspace-preview.zh.md)

## Problem

Buddy needs workspace file browsing, previews and file references while keeping upstream UI packages independently upgradeable.

## Decision

Implement the panel in the Wanwei product UI and bounded filesystem operations in the product desktop shell. Use the existing composer reference and deliverable presentation interfaces. Browse expanded directories, search child paths and preserve opened-file tabs. Preview DOCX through docx-preview, PDF through pdf.js, and worksheets through SheetJS. Convert legacy Office formats and presentation files with an installed LibreOffice. Text edits and unique single-run DOCX replacements save through a digest-checked temporary-file replacement.

## Alternatives considered

Directly importing Parvis runtime components would couple Buddy to its Solid and backend services. Rewriting upstream panels would increase upgrade conflicts. This implementation adapts the product interactions to React and the desktop bridge.

## Consequences

The product UI and desktop shell must be rebuilt together. LibreOffice conversion requires a local installation or SOFFICE_PATH. XLSX preview currently shows formatted values for up to 500 rows and 50 columns. Presentation rendering, rich Word editing, image compatibility and desktop drag behavior still require parity work and real-file acceptance against Parvis. Existing frontend tests and native save/path tests validate the implemented subset, not complete migration parity.
