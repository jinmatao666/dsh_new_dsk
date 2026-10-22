---
description: "Authenticate the Wanwei desktop against OneAPI and use server-governed models, search and expert website tickets without exposing generated tokens to the browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-oneapi-auth

English | [中文](README.zh.md)

## Summary

Successful logout from the account section closes the settings panel and reveals the login page. A failed logout keeps the panel open and displays the error.

The login surface uses the same form and fixed-height content area during authentication checks and after logout. It recalculates scaling whenever the login page becomes visible, independently of workspace typography.

The desktop login layout uses Windows-reference column sizing and explicit text line heights. System fonts remain local, so glyph rendering can differ. WebKit receives prefixed backdrop-filter rules.

Client authentication ignores obsolete status replies and refreshes overlapping a login or logout. Cancelled refreshes do not publish offline state. This orders Client state updates; it does not cancel authentication work already accepted by the Host.

Users sign in to the configured OneAPI service and use the models permitted for their account. The desktop reads a server-managed model catalog rather than exposing local provider editing. The Host also requests published expert entries and one-use website tickets while keeping the OneAPI token outside the Client.

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

The Wanwei product bundle mounts the Host and Client halves. The browser receives authentication state and model identifiers, not passwords or generated tokens.

Version settings appears before Account and shows the current version, automatic-check switch and manual check button when the desktop bridge is present. A plugin-owned monitor shows download and installation progress in a separate modal independently of settings navigation. Hiding download progress does not cancel the download; Version can reopen it. Unknown sizes use indeterminate progress, and installation progress cannot be dismissed. Native download and installation confirmations remain unchanged. The Host's parent-only update protocol rejects busy agents, maintenance, tools, jobs and registered automation intervals, then awaits whole-tree disposal before acknowledging shutdown. Browser-only deployments have no installer controls. Native scheduling, signing configuration and platform acceptance belong to the [desktop shell](../../../products/wanwei-desktop/README.md).

### Configuration

Managed resource tunnels reuse the authenticated OneAPI origin through a loopback-only proxy and a WebSocket route, without another public port. Backend settings select `transport: tunnel`; omitted transport selects an independent forward proxy. Optional bypass hosts extend NO_PROXY. HTTPS target certificates remain verified, but an HTTP/WS entry does not protect relay credentials or connection metadata. Source changes revoke active managed bridges and plugin disposal closes the listener. See the [resource guide](../../../products/wanwei-desktop/resource-relay/README.md) for deployment and acceptance.

The configured backend's System Settings owns the network environment and independent automation/connector entry visibility for each environment. The Host reads `/api/desktop-config` before login and during authentication refresh, then caches the confirmed policy in `wanwei-network.mode`. Refresh also occurs on focus, visibility and the existing five-minute authentication timer. Missing feature settings default to automation enabled in both environments and connectors enabled only on Internet; explicit malformed flags reject the refresh without replacing committed Client state. A failed configuration lookup blocks login rather than assuming Internet mode. Both modes permit expert service requests, local scheduling and installed SkillHub skills; actual service requests determine availability. `serviceTimeoutMs` bounds deployment and expert requests and defaults to 15000 milliseconds. Public web search, generic public web fetch and generic public HTTP(S) link policies remain restricted in intranet mode. Private literal addresses, local DNS names and the configured OneAPI origin remain available. Additional internal domains require explicit classification changes.

Knowledge-base visibility defaults to enabled in each environment when only the `knowledgeBases` field is absent from a legacy feature object. Existing automation and connector flags and explicit knowledge-base denial remain unchanged; null and non-boolean values fail validation. OneAPI configuration reads and the administrator settings page apply the same rule without rewriting stored configuration until an administrator saves.

Version settings shows a check result only after a manual check in that mounted page; reopening clears result visibility. It does not repeat the static download/install reminder below the check button. Missing updater configuration and bridge errors remain visible. A no-update response says no update was found and names the current version; it does not claim the backend has a published release. Automatic checks and native confirmation dialogs are unchanged.

Forgot password reads the backend's maintenance contact into a separate dialog. SMS and QR login display an unavailable notice without replacing account login. The login card keeps its existing sizing; no registration or simulated authentication controls are provided.

The network snapshot includes `directInternet` after deployment confirmation. Intranet confirmation reuses the resource route's cached direct probe without starting a tunnel. Disabled detection, offline resources or a failed probe report false; Internet mode reports true. The Client validates and publishes that result for automation and connector entry availability, without changing administrator visibility or native network mode.

Private-network resource settings select either the backend wheel bundle or a forward proxy, without cross-source fallback. Offline mode configures pip with `PIP_NO_INDEX` and the backend wheel links; proxy mode configures proxy-aware child clients. Automatic detection requires every configured HTTPS endpoint to return 204, concurrently within 2.5 seconds, and caches the result for 60 seconds. Shell execution refreshes deployment settings at most once per minute and refuses new commands if refresh fails. Running children keep their environment. See [resource setup and acceptance](../../../products/wanwei-desktop/resource-relay/README.md).

In intranet relay mode, default-index `python -m pip download/install` uses Huawei Cloud, Tsinghua and official PyPI sequentially. Each attempt has a 30-second complete budget and no pip connection retries. Only recognizable network or package-availability failures advance to the next index; permission, build, argument and integrity errors stop. All attempts inherit the selected network route; fallback never bypasses the relay. Explicit index/proxy options and local `--no-index` installs remain unchanged. The process-local Python module overlay does not edit installed pip or global configuration. Direct `pip` launchers, isolated Python (`-I`/`-E`) and overridden `PYTHONPATH` do not use the ordered wrapper. No backend UI is provided; `pipMirrorUrls` and `pipMirrorAttemptSeconds` are product plugin configuration fields. Offline resources and Internet mode do not activate the wrapper.

Recognized Bash, PowerShell and terminal results distinguish missing modules, connection failures and unavailable package versions, retain original output and append Chinese guidance. Successful managed fallback suppresses feedback for earlier failed attempts, but later command failures remain eligible. The model is instructed to retain the warning icon, explicitly mention private-network mode and blocked task progress, and briefly explain the actual cause without recovery suggestions or long raw diagnostics. Dependency names come from the current command and failure log; unconfirmed names remain generic. Dependent steps stop only when an essential dependency remains unavailable. Permission and syntax errors are not classified as network failures.

This is diagnostic feedback, not a firewall or shell sandbox. Unrecognized diagnostics receive no automatic dependency feedback. The dependency prompt section follows the confirmed mode for future prompt assembly; historical messages are not rewritten. Internet mode adds no dependency prompt section or feedback. Assistant headings, brevity and retry decisions follow model guidance rather than a deterministic response template.

[The product patch](../../bundle/wanwei-desktop/cordis.patch.yml) supplies the provider route and generated-token reference. The Host resolves an explicit OneAPI origin first, then `DSH_ONEAPI_URL` from the launch environment, then the local development origin.

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `DSH_ONEAPI_URL`, then `http://127.0.0.1:3000` | Explicit OneAPI origin without `/v1` overrides the launch environment. |
| `provider` | `dsh-server` | Managed DSH model provider route. |
| `credentialRef` | `DSH_ONEAPI_TOKEN` | Stored generated-token reference. |
| `tokenName` | `DSH Desktop Auto Token` | Name for automatically created OneAPI tokens. |
| `defaultModel` | optional | Preferred default model identifier. |
| `defaultInput` | `[text]` | Modalities advertised for model IDs; enable image only when supported. |
| `installId` | optional | Build-specific marker for login after a new installation. |
| `developmentBypass` | `false` | Source-only development login-overlay bypass. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The loopback Host exchanges credentials with OneAPI, delegates the generated token to the DSH credentials provider, reads the allowed models, and configures the managed pi-ai provider. The Client renders the login gate, account section and read-only model section through slots. The Host uses the same signed-in token for the configured `oneapi-bailian` search provider and for a one-use expert launch ticket. Only the selected website URL and short-lived ticket cross to the Client.

The Host also reports skill references resolved by the official injector and each model-issued `skill` tool call to OneAPI. The server stores their `user_explicit` or `model_auto` invocation type while the administrator's totals combine both types. Stable event IDs deduplicate delivery retries, not separate calls. Delivery retries remain in memory while the desktop process is running; events not delivered before exit are not replayed after restart.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Product composition](../../bundle/wanwei-desktop/README.md) — mount order and model-settings override.
- [Independent expert plan](../../../WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md) — website identity and acceptance scope.

-----

<a id="model-experience"></a>
## Model Experience

### Managed model request

#### What the model sees

The `dsh-server` provider offers only models returned for the signed-in OneAPI account. Login state and the generated token are not added to the model prompt.

#### Token effect

Signing in and listing models consumes no model tokens. A user request uses the selected model through the ordinary DSH LLM provider and its normal usage accounting.

#### KV Cache effect

Authentication alone does not change a prompt or cache key. Model selection and subsequent requests follow ordinary provider cache behavior.

### Managed web search

#### What the model sees

The `oneapi-bailian` search provider returns structured retrieval sources through the existing DSH web tool path. The model receives real HTTP(S) URLs and instructions to cite them beside relevant claims; the search card also exposes clickable sources. Missing sources produce an explicit verification warning, never synthesized source metadata. The server-selected search model and token do not appear as prompt text. HTTP 400 failures show a bounded error code and explain recognized endpoint or streaming mismatches without replaying raw upstream diagnostics. The tool asks the model to stop repeated searches and report a backend configuration issue; this is guidance, not a deterministic retry lock.

#### Token effect

Search requests use the configured OneAPI service. Any tool-result tokens enter the normal model context when the agent uses the result.

#### KV Cache effect

Different search results may change subsequent prompt content and cache reuse; this package does not manage the model cache.

### Private-network dependency feedback

#### What the model sees

Only private-network mode adds dependency guidance to the system prompt. Explicit resource settings replace generic guidance with the selected source's restrictions: offline mode forbids changing indexes or using public package URLs; proxy mode forbids falling back to offline bundles. Recognized missing-dependency and download failures return Chinese guidance through ordinary tool results, visible to both the model and the conversation UI. Successful downloads receive no failure feedback. No separate popup or fabricated assistant message is inserted.

#### Token effect

The private-network guidance and appended tool feedback consume normal context tokens. Internet mode adds neither.

#### KV Cache effect

Changing the confirmed environment changes the dependency prompt section and can affect prefix-cache reuse. This package does not manage model caches.

### Verified final file delivery

#### What the model sees

The Host exposes `deliver_files` to declare the complete final output list before the final reply, excluding intermediate files. The tool verifies regular files, resolves workspace-relative paths and deduplicates filesystem identities. An empty list clears file delivery, not the text answer. Text-only tasks may omit the call or declare an empty list. File registration adds no turn-stopping reminder or follow-up request; the final reply contains the requested answer rather than a file-list acknowledgement.

#### Token effect

The static guidance, tool schema and file-path results use normal context tokens. File registration does not force an additional request after a completed answer.

#### KV Cache effect

Static guidance can reuse the prompt prefix. Delivery paths vary with the task.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Model discovery, managed search and the expert catalog require a reachable OneAPI service. The desktop has no local provider-editing fallback.
- Resource routing covers pip wheels and proxy-aware child clients, not browser traffic, native PowerShell downloads or Node fetch. It is not a network sandbox. Proxy credentials, source archives, OS packages and offline npm packages are not supplied. Internal OneAPI traffic bypasses the shell proxy. Public search and link restrictions remain independent.
- Search sources require the updated OneAPI relay and a channel exposing Bailian's native generation endpoint, not only its compatible chat endpoint. Model compliance with citation instructions still needs live acceptance; links alone do not establish factual accuracy.
- Independent expert launch requires the separate OneAPI `/api/expert-web` deployment and database tables; the ordinary login endpoint alone does not provide it.
- Website tickets and child Webview permissions still require live service and cross-platform desktop acceptance.
- Final delivery verifies file existence, not document quality or user intent. The model must call the tool directly with the correct final list; nested dispatch does not declare the UI list. Installed-desktop and live-model acceptance remain required.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
