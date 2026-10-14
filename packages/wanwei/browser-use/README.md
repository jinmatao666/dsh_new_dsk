---
description: "Configure the official Playwright MCP browser provider in the Wanwei desktop runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-browser-use

English | [中文](README.zh.md)

## Summary

Agents can inspect and operate a Chromium browser through the pinned official Playwright provider. Each live Session owns a separate browser connection. The desktop configuration controls activation and visibility; pure intranet mode denies browser tools. This package does not download a browser.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The settings card starts collapsed. Its header expands or collapses the permission controls without changing the saved preference; the switch saves immediately and keeps failures visible while expanded.

Mount this plugin before creating Sessions. Without `executablePath`, the plugin searches standard Chrome then Edge installation locations on Windows/macOS; Linux searches Chrome, Chromium and Edge commands on PATH. A custom absolute executable path takes precedence and must be an accessible executable file. Missing browsers cause Chinese tool feedback instead of automatic downloads. Installing a browser or changing its path requires restarting the desktop and creating a new Session.

```yaml
- name: '@deepseek-ai/dsh-wanwei-browser-use'
  config:
    enabled: true
    headless: false
```

The Browser assistant card appears first in Settings → Plugins → Plugin configuration. Its switch defaults to enabled and automatically persists `wanwei-browser-use.enabled` through the Host settings document. Disabling hides browser schemas and denies subsequent calls, including tools already known to an existing Session; running operations and Session resources are not forcibly terminated. Re-enabling restores subsequent calls without reinstallation. Pure intranet mode disables the switch and browser tools without overwriting the saved preference. The desktop layer accepts `DSH_BROWSER_USE_ENABLED=0` as the composition default and `DSH_BROWSER_EXECUTABLE` for its executable path; the persisted preference takes precedence over the default. Changing the executable path requires new Sessions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider-local Context supplies a validated Session working directory and a cancellable initialization signal. Prompt assembly waits for initialization and recollects schemas before admitting the first request. Agent and plugin disposal wait for owned startup work; the official runtime owns MCP serialization and process cleanup. The shared Agent registry and loop are unchanged.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Desktop bundle](../../bundle/wanwei-desktop/README.md) — product composition.
- [MCP client](../../mcp/mcp-client/README.md) — tool discovery and transport.
- [Official provider](https://github.com/deepseek-ai/deepseek-harness/blob/d743267/packages/experimental/browser-use-playwright-mcp/README.md) — provider behavior.

-----

<a id="model-experience"></a>
## Model Experience

### Browser tools

#### What the model sees

The official provider contributes `mcp__playwright-mcp__` tools and MCP instructions. Snapshot file links resolve from the Session working directory. Pure intranet mode hides browser schemas and denies direct browser execution with `纯内网环境暂不开放浏览器自动化`. Browser guidance tells the model to stop on startup failure rather than download browsers or substitute shell/CDP scripts; recognized startup errors retain the original diagnostics after Chinese corrective feedback in the tool result. This guides model behavior, not a blanket shell-execution prohibition. Captchas require manual user handling.

#### Token effect

Tool definitions, browser instructions and results add model input tokens; browser tasks use the selected model route.

#### KV Cache effect

Stable tool definitions reuse their prompt prefix; activation or policy changes alter the catalog.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The current integration has explicit deployment limits.

- The official provider is experimental and pinned to `0.2.1-alpha.2`; its peer versions differ from this runtime and require integration tests.
- Browser automation is disabled in pure intranet mode until browser-network confinement is implemented; this plugin is not a firewall.
- Nonstandard browser locations need `executablePath` or `DSH_BROWSER_EXECUTABLE`; no bundled Chromium, Firefox/WebKit selection or compatibility guarantee for third-party Chromium browsers is supplied. The settings card reports permission state, not browser connection readiness.
- Cross-platform installer and real model-driven conversation validation remain required.

<a id="dev-note"></a>
### Dev Note

None.
