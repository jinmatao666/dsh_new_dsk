# Kylin desktop shell

English | [中文](README.zh.md)

This Linux shell compiles the business commands from [src-tauri](../src-tauri/src/lib.rs) against Tauri 1 and embeds expert WebKit views inside the main GTK window. Windows, macOS and modern Linux use the existing Tauri 2 shell. Business pages, APIs, skills and the Node sidecar have one source; GTK view management and the native transport require separate platform maintenance. New native commands need registration in both shells.

The [Kylin-only entry point](../../../.github/workflows/wanwei-kylin-preview.yml), named Wanwei Buddy Kylin only, runs just the x64 and ARM64 compatibility jobs. Register this entry point on the repository default branch to expose its Run workflow button; select source_ref=new-version and the desired version, leaving official_release unchecked for testing. It calls the shared Kylin workflow from new-version. The desktop preview workflow keeps its full platform matrix.

The container trusts only its mounted checkout directory in the persistent Git configuration and verifies HEAD before dependency installation. This lets subsequent shell steps read source metadata despite the checkout action using a temporary HOME.

The [desktop preview workflow](../../../.github/workflows/wanwei-desktop-preview.yml) enables the Kylin build with its default-on build_kylin input. The [dedicated workflow](../../../.github/workflows/wanwei-kylin.yml) can also run independently. Both architectures build in Ubuntu 20.04 containers. Native GTK linking and graphical tests require Linux runners for this user-authorized compatibility build, despite the repository's general Windows runner preference.

Choose the wanwei-buddy-VERSION-kylin-arm64 artifact for the supplied Kylin aarch64 machine. Its installer filenames include -kylin, keeping them distinct from modern Linux artifacts. DEB declares system dependencies; AppImage includes additional libraries but still has a system ABI floor. Both formats are extracted and audited before upload. The audit rejects wrong architectures, missing libraries, WebKit 4.1 or libsoup 3, GLIBC above 2.31, GLIBCXX above 3.4.28 and CXXABI above 1.3.12.

Kylin updates use replacement installers. Tauri 2 automatic update bundles are not offered by this shell. Closing the main window hides it; the tray menu exits and stops the sidecar.

## Verification

The WSL Ubuntu 20.04 x86_64 validation passes compilation, Rust business tests and a real WebKit smoke with two embedded experts, native file reads, expert command authorization, ticket bootstrap, geometry shrinking, visibility, JavaScript state preservation, close and logout. Bridge tests cover origin and document isolation, error propagation and timeouts. The complete staged sidecar passes startup, authentication exchange and clean shutdown on the native Linux filesystem. The full x64 DEB builds and passes dependency metadata and extracted-payload audits covering 11 ELF files. Local AppImage bundling remains unverified because a helper download is blocked. The smoke uses local test pages with Xvfb and software rendering; it does not establish real expert login, installed-device focus/input, GPU, Wayland or ARM64 compatibility. Release and target-device tests must cover those remaining conditions. The [decision record](../../../.agents/notes/proposed/architecture/2026-11-16-kylin-desktop-shell-isolation.md) describes the remaining acceptance conditions.
