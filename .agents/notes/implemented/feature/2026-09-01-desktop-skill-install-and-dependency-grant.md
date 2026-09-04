# Agent Note: Desktop skill installation and dependency grant

Status: implemented

English | [中文](2026-09-01-desktop-skill-install-and-dependency-grant.zh.md)

## Problem

Desktop users need an install action in the skill marketplace that creates a skill the local runtime can discover. Workspace Write sessions also need an explicit first confirmation before downloading a missing dependency without repeatedly interrupting one task after that consent.

## Decision

The desktop installer carries official skill bundles as inactive read-only resources. The marketplace passes only a catalog slug to a native Tauri command, which validates the bundled manifest and atomically copies the complete bundle into the current user's `.dsh/skills/<slug>/` directory. The filesystem skill provider watches only that user root, so bundled skills remain unavailable until installation and a newly created conversation discovers an installed skill through the ordinary catalog. Installation state comes from the filesystem rather than browser storage. Updates and removal accept only a matching marketplace manifest or a recognized legacy marketplace `SKILL.md`; unrelated same-name user directories remain untouched.

The marketplace ships three independent GIS_Service bundles—geological conditions, land-use planning review, and third-survey land-use analysis. Each bundle owns its `SKILL.md`, manifest, PowerShell invocation script, and API reference. The scripts accept GeoJSON, a Polygon Shape file, a directory containing one complete Shape dataset, or a safe Shape ZIP. They validate the required `.shp`, `.shx`, and `.dbf` files, read polygon geometry and optional `.prj` coordinate-reference metadata, call the documented service endpoint through Windows PowerShell, and save a timestamped raw response plus a Markdown input-and-response summary in the workspace. They use the deployed GIS_Service URL by default and accept an explicit or environment-provided override. Each API reference defines the confirmed result fields the model may explain; the skills preserve unlisted fields without inferring planning or geological conclusions.

`ApprovalService` optionally remembers an allowed package-manager escalation for one live session. It recognizes only `pip`, `npm`, `pnpm`, and `yarn` install commands recorded on `bash` or `pwsh` tool calls. The first matching escalation reaches the normal human approval channel; later matching escalations receive an in-memory one-shot result without another prompt. Desktop enables this option through `DSH_DEPENDENCY_INSTALL_APPROVALS=session-once`.

The deliverable row excludes helper source extensions and uses successful mutation locations or an explicit generated, saved, written, output, or deliverable terminal line as its evidence. Terminal-delivered JSON and Markdown analysis files appear alongside office documents. It does not infer artifacts from assistant prose.

## Alternatives considered

**Keep marketplace installation in browser storage** — rejected. A browser-only installed marker cannot place a skill in the host catalog or make it callable by a new conversation.

**Send skill source from the renderer to the native installer** — rejected. Renderer-provided source can diverge from the reviewed package and gives web content authority to create arbitrary user skills. The native command installs only validated resources shipped with the application.

**Install every bundled skill on application startup** — rejected. Preinstalling the bundles makes them model-visible without a user choice and prevents the Marketplace from representing actual local state.

**Grant all later sandbox escalations after one dependency approval** — rejected. A package installation grant must not authorize unrelated commands or filesystem actions.

**Remember dependency grants across sessions** — rejected. A new task needs a fresh user decision and session persistence would introduce revocation and auditing requirements.

## Consequences

Installed marketplace skills are local to the desktop user and become available after the next conversation catalog fetch. The Marketplace UI can still render in a non-desktop browser, but only official packaged entries expose an enabled install action. Mock entries remain previewable and identify that no installable package exists.

The checked-in official manifests generate the desktop metadata projection and the administrative mock projection. The administrative preview reads the real static package files and builds downloads from those bytes; mock edits and publication state remain browser-local and do not alter a released desktop catalog.

The desktop sidebar exposes Automations, Connectors, Expert Teams, and the Marketplace as separate actions stacked above Settings. Each action owns its own overlay and navigation state; the Marketplace no longer uses top-level product tabs to switch among those surfaces.

The Automations overlay is a local presentation prototype: configured tasks, templates, execution history, and creation forms are kept only in component state. The interface explains that it does not schedule jobs, create a conversation, or access a connector until those services are deliberately introduced.

The Connectors overlay is also a local presentation directory. It uses bundled brand-styled SVG marks, compact cards, and per-connector details to show the intended authorization scope without collecting credentials or contacting third-party services. Custom entries remain in component state and are explicitly marked as demonstrations until a managed connector service exists.

The Expert Marketplace separates individual specialist roles from specialist teams. The individual entries describe one future agent profile, while team entries describe future multi-role workflows and their skills. Both surfaces stay in local component state and must not imply that an agent or team is already provisioned or executing.

Marketplace installation uses the public Tauri bridge when available and falls back to the persistent Tauri internals bridge for external-sidecar pages. Installation and failure feedback remains visible from both the skill list and a skill detail page.

The GIS_Service skills require polygon geometry with a coordinate reference compatible with the service. A Shape ZIP is extracted only to a temporary directory and removed after the request. Each invocation leaves only a timestamped raw response JSON and Markdown report that records the inspected input, coordinate reference metadata, response fields, and record counts. The chat summary may explain fields listed in the skill's API reference and does not invent meanings for unlisted fields.

The dependency convenience applies only after an existing escalation path and does not change Full Access behavior. It reduces repeated prompts without widening the session's general sandbox policy.

Workspace Write treats a pre-existing output filename as a user-owned choice. The agent asks whether to create a versioned file, read then overwrite the existing file, or cancel. Full Access lets the agent choose a versioned file or replacement without asking, but replacement still requires reading the existing file first.

## Verification

Focused approval and deliverable tests cover the session grant and source-file exclusion. GIS invocation checks cover GeoJSON, Shape ZIP, Shape directory, and direct Shape-file inputs, including timestamped JSON and Markdown artifacts. Catalog validation checks identifiers, versions, declared files, and path containment. Native tests cover complete-directory installation, updates, legacy migration, ownership refusal, and removal. Type checking covers the marketplace, approval, and deliverables packages; Rust checks cover the desktop native commands.
