# Agent Note: Independent website installer publication

Status: implemented

English | [中文](2026-10-30-website-installer-publication.zh.md)

## Problem

First-time visitors need EXE or DMG installers. Signed desktop update ZIPs serve an installed client and cannot supply the same download flow. The marketing website deploys independently of the backend image.

## Decision

OneAPI manages three installer targets with separate immutable uploads and one publication pointer per target. Root administrators upload, publish, withdraw, and delete through the Version Release page. Public catalog and download handlers expose only selected, published uploads. Withdrawal has no historical fallback.

Files share the updater's persistent parent directory under a dedicated `website-installers` child. Database records, publication controls, and file validation remain independent of signed updates. The public catalog permits credential-free cross-origin reads so a separate website can consume it; the backend image contains only its management interfaces.

## Alternatives considered

**Reuse signed update artifacts.** This mixes first-install formats with Tauri update signatures and publication state, so it does not meet the separate release controls.

**Bundle the marketing website in the backend image.** The user requires independent deployment; the public catalog provides that connection without bundling site assets.

**Use another persistent mount.** A child of the existing updater mount preserves deployment and backup configuration while keeping artifact directories separate.

## Consequences

Windows validation accepts an x86 NSIS bootstrapper only when the PE overlay has the NSIS first-header signature and an archive length within the file. The x64 NSIS setup artifact uses an x86 bootstrapper, so requiring an AMD64 outer EXE rejects the project's own installer. Accepting every x86 EXE would also accept ordinary x86 programs; the NSIS check retains that distinction. Payload architecture remains administrator-supplied metadata rather than a certification by the upload API.

The backend supplies a stable catalog and verifies stored file hashes on publication. Administrators remain responsible for product version, DMG architecture, operating-system signing, and real installation checks. The separate website still needs to consume the catalog. Both database and storage require backup. See the [operational reference](../../../../services/one-api/docs/website-installers.md).

## Testing

Controller/router tests cover authentication, disk persistence, all three targets, invalid formats, size limits, tampering, replacement, withdrawal, deletion, and GET/HEAD/range downloads. React tests cover upload metadata, retry, target switching, confirmation, and server-backed state. These checks do not establish production proxy behavior or real installer validity.
