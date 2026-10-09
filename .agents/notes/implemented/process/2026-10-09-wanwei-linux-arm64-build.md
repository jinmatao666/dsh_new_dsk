# Agent Note: Native Linux ARM64 desktop builds

Status: implemented

English | [中文](2026-10-09-wanwei-linux-arm64-build.zh.md)

## Problem

The Wanwei desktop preview requires Linux ARM64 installers for customer computers. An x64 installer cannot provide an ARM64 Node runtime or native desktop executable.

## Decision

The [desktop preview workflow](../../../../.github/workflows/wanwei-desktop-preview.yml) includes a native `ubuntu-22.04-arm` matrix entry. Linux dependency setup selects musl paths from the host architecture, and installer uploads and diagnostic steps apply to both Linux entries. Runner configuration rejects a Linux architecture that differs from the requested platform. The runner stages its own Node executable and production dependency closure.

## Alternatives considered

**Cross-compile on the x64 runner.** Native builds avoid a separate cross-toolchain and emulation path for Node dependencies and runtime verification.

## Consequences

Linux ARM64 and x64 have distinct cache and artifact names. Both request DEB and AppImage bundles. Configuration tests exercise accepted ARM64 and x64 runners and reject mismatched architectures. A successful workflow build does not verify UOS 1041 runtime-library compatibility; target-machine installation remains separate verification.
