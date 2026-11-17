# Agent Note: Isolate the Kylin desktop shell

Status: proposed

English | [中文](2026-11-16-kylin-desktop-shell-isolation.zh.md)

## Problem

The Kylin ARM64 target provides glibc 2.31, GLIBCXX through 3.4.28 and WebKitGTK 4.0. Supplied installer logs show that the Tauri 2 artifacts require newer libraries. Windows and macOS must retain their existing shell, while Kylin must preserve embedded expert views.

## Proposal

Keep business sources and native command arguments shared, with an independent [Kylin shell](../../../../products/wanwei-desktop/src-kylin/README.md) and build entry point. Its Cargo package compiles the production Rust business modules with a package-scoped configuration flag; Windows/macOS retain Tauri 2. The Linux adapter manages embedded GTK views, an origin- and document-scoped native bridge, expert command authorization, tray lifecycle and shared sidecar startup. New native commands require registration in both shells, while ordinary business changes remain shared.

The [Kylin workflow](../../../../.github/workflows/wanwei-kylin.yml) builds x64 and ARM64 in Ubuntu 20.04 containers, checks runtime symbols and installed payloads, and emits distinct Kylin installer names. The desktop preview workflow calls it in parallel with the existing matrix. Native GTK libraries and graphical validation require Linux runners; the user's requested Linux compatibility build authorizes this exception to the general Windows runner preference. Updates use replacement installers; Tauri 2 automatic update bundles remain outside this adapter.

The container registers only GITHUB_WORKSPACE as a trusted directory in its persistent Git configuration and verifies HEAD immediately after checkout. Runs 126 and 128 fail while reading source metadata; an Ubuntu 20.04 / Git 2.25.1 fixture reproduces exit 128 for a repository owned by the host UID and succeeds after the scoped trust registration. The original build suppresses Git stderr, so the fixture establishes the failure mechanism without claiming the unavailable runner stderr was observed.

The existing desktop workflow offers build_scope=all (default) or kylin. Kylin-only mode retains official-composition verification, skips the Tauri 2 desktop matrix, enables the Kylin reusable job regardless of build_kylin, and skips full-platform release publication. Missing build_scope retains the all-platform behavior. This supports the user requirement to leave main untouched.

Installer formats have independent build, audit and upload steps. Run 132 uploads audited ARM64 DEB, x64 DEB and x64 AppImage artifacts. Its ARM64 AppImage log identifies AppImageKit 5735cc5 rejecting the generated aarch64 alias and reporting multiple architectures during directory scanning. That tool accepts arm_aarch64; its scanner reads machine bytes from executable files without checking the ELF magic, allowing text files to affect detection. The workflow retries only this ARM64 error, using the verified generated final command and the legacy alias without repeating compilation or library deployment. Unexpected generated script contents, unrelated build errors and retry failures remain fatal. The resulting image still requires payload and bootstrap audits. DEB uploads independently, and verbose logs remain available as evidence. Focused shell fixtures exercise successful retry, normal builds, unrelated errors, x64 rejection, retry exit-code preservation and changed-script rejection. Target-device compatibility and the complete ARM64 AppImage remain unverified until release and device testing.

## Alternatives considered

The target-device report establishes that disabling compositing and using software GL restores the blank window. These are Kylin-only startup defaults with explicit environment overrides. Real pointer testing reproduces the unmodified shell blocking main-page clicks: the full-window expert container intercepts empty-space input. Passing that input through also exposes Wry 0.24.12 mouse/touch handlers assuming that the main WebView's grandparent is GtkWindow. The shell installs GtkOverlay directly under that window and passes through its expert container, preserving child WebView input. The replaced Tao container may contain only the main view and an empty menu bar; unsupported controls cause an explicit startup failure. The graphical smoke uses X11 pointer events and keyboard input rather than JavaScript-dispatched clicks, and removes external rendering overrides so shell defaults are exercised. It covers main input before, during and after embedded expert use, expert pointer input and the existing native bridge and layout checks. Browser-only sessions intentionally lack the desktop native bridge.

A separate YAML with unchanged Tauri 2 sources retains the incompatible dependencies. A standard Tauri 1 window port does not replace the embedded expert API; separate windows violate the user's requirement. The GTK experiment uses Tauri 1 platform WebView access and parent-container allocation. An Electron Linux shell remains an alternative if production GTK integration fails its acceptance criteria.

## Acceptance criteria

The Linux shell must run on the target library baseline, embed multiple expert views with correct geometry and visibility, preserve sessions, authorize native commands, and launch the actual business runtime. Existing Windows/macOS behavior must remain intact. Ubuntu 20.04 x86_64 compilation, shared Rust tests and real WebKit tests pass native file reads, expert authorization, ticket bootstrap, two-view geometry, visibility, state preservation, close and logout. The staged sidecar passes startup, authentication exchange and clean shutdown; the complete x64 DEB passes metadata and payload audits. Local AppImage bundling is blocked by a helper download. The proposal remains open until both installer formats and the ARM64 target device meet acceptance.

## Risks

The graphical tests use local HTML, Xvfb/X11 and software compositing. Real expert authentication and cookies, input/focus, high DPI, Wayland, GPU, tray integration and the complete staged Node sidecar still require installed-device checks. x86_64 evidence cannot establish ARM64 compatibility. The production shell shares conditional compilation changes and its workflow includes a new job; Windows/macOS native builds have not been rerun locally. The adapter adds maintenance for GTK embedding and bridge registration, and Tauri 1's older dependency stack requires ongoing review.
