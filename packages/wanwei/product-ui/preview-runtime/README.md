# Parvis preview runtime

English | [中文](README.zh.md)

The Office, presentation, worksheet, image, selection and zoom implementations originate from `Parvis-old/packages/app/src/components/session` and `utils/preview-edit.ts`. The original MIT license is retained in [LICENSE](LICENSE). File artwork comes from `packages/ui/src/assets/icons/file-types`; the chart renderer comes from `components/writing-chart-renderer.ts`.

Buddy runs these Solid components in an opaque-origin iframe. Only file bytes, display metadata and text selections cross the message boundary. The iframe receives no native bridge or filesystem access. `build.mjs` compiles Solid and its scoped Tailwind styles into the product client bundle, inlines the PDF worker, fonts, character maps and WebAssembly files, and replaces Parvis-only imports with local adapters. No runtime request to the Parvis repository or a document viewing service is required.

HTML uses sanitized `srcdoc` instead of `contentDocument.write` because the renderer's opaque origin prevents the latter. Markdown uses Buddy's existing Marked dependency with DOMPurify and the original selection/CSS layer. The icon-button adapter supplies local SVG controls. Product palette tokens are supplied locally. These are host adapters, not replacement Office parsers.

The React owner controls workspace browsing, opened files, independent drafts, original-path composer references, drag feedback, panel resizing and digest-checked native saving. Explicit model actions use the selected Buddy session, correlate the submitted request with its completed turn and put edits or charts into a reviewable draft. They consume the selected model's normal usage. Legacy DOC, XLS and PPT conversion still requires LibreOffice or `SOFFICE_PATH`.

From the repository root, run `node packages/wanwei/product-ui/tests/preview-runtime.browser.mjs` for the headless browser checks. They render Word, merged/multiple Excel sheets, Markdown, sanitized HTML, image zoom, PPT navigation and a two-page PDF. Model-response correlation and Word cross-run editing have focused Vitest coverage. Native tests cover path boundaries, concurrent-edit rejection, file operations and recoverable deletion. This evidence does not substitute for the rebuilt desktop application's real-provider acceptance test.
