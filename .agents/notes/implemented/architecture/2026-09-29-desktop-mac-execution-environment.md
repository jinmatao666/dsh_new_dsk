# Agent Note: Desktop Mac execution environment and recorded artifact links

Status: implemented

English | [中文](2026-09-29-desktop-mac-execution-environment.zh.md)

## Problem

Mac desktop test logs show that bare Node commands cannot find the bundled runtime and Python installation/cache writes fail under workspace-write. Model-authored local URIs also produce inert links even when a successful skill result records the actual artifact.

## Decision

The product shell owns macOS PATH and Python-cache configuration in `sidecar_environment.rs`. It preserves the inherited host temporary directory, prepends bundled Node, retains inherited tool paths and adds Homebrew paths. Python caches live in a private product-keyed host-temp directory, which the existing sandbox policy already permits. Existing directories must be real directories owned by the application-data owner with no group or other permissions. Windows and Linux launch environment settings remain unchanged.

The product UI owns skill result/path markers. The generic Markdown renderer uses the existing optional file-mention resolver for settled non-web links. URI-shaped references resolve only to exact recorded artifact paths; they never authorize navigation to a new scheme or infer a file from the link label. No product protocol enters official packages.

## Alternatives considered

**Grant application-data writes or disable confinement.** This would expose credentials and settings to task commands. Keeping Python caches in the existing temp allowance preserves the official policy and read-only behavior.

**Change Windows skill scripts or rewrite GIS skills in the desktop.** Windows is already working, and skill entrypoints belong to platform skill maintainers. Desktop fixes do not rewrite their business logic.

**Allow arbitrary local URL schemes.** Model output is untrusted. Recorded artifact identity and the existing file opener retain authority instead of launching authored URLs.

## Consequences

Host temporary caches are reusable but may be evicted by the OS. Missing Python, FFmpeg or skill libraries still require installation or skill-side adaptation; the desktop does not download arbitrary binaries or silently escalate permission. Skill-reported audio duration and factual result quality remain skill/model responsibilities. macOS sandbox, Homebrew discovery and installed-file opening require real-device acceptance; Windows tests exercise unchanged environment settings and cross-platform artifact references.
