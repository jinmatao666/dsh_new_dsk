# Agent Note: Desktop release status

Status: implemented

English | [中文](2026-10-29-desktop-release-status.zh.md)

## Problem

An installer version alone does not tell testers whether a desktop build is for gray testing or formal release. The Version settings page needs to show the status of the build currently running, including after an offline installation.

## Decision

The desktop preview workflow offers an `official_release` checkbox, unchecked by default. It passes `DSH_RELEASE_OFFICIAL` to the Tauri build. The build script validates and embeds the Boolean value, and the native update snapshot exposes it as `currentOfficial`. The Version settings page shows a gray “Gray testing” badge or a green “Official” badge beside “Desktop”. This describes the installed build, while update availability continues to follow the published update manifest and version rules.

## Alternatives considered

A server-side label would change when a release record changes and could misidentify an already installed offline build. Encoding the status only in the version number would require users to interpret a naming convention instead of reading a clear label.

## Consequences

Builds created without the workflow input are marked for gray testing. The status is fixed at build time; changing a server release record does not relabel an already installed client. Older desktop bridges without `currentOfficial` show no status badge.

## Testing

The desktop update client tests cover both status values, the Client TypeScript program typechecks, and the Tauri desktop update tests pass.
