---
description: "Authenticate the Wanwei desktop against OneAPI and use server-governed models, search and expert website tickets without exposing generated tokens to the browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-oneapi-auth

English | [中文](README.zh.md)

## Summary

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

### Configuration

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

The `oneapi-bailian` search provider returns results through the existing DSH web tool path; its server-selected search model and token do not appear as prompt text.

#### Token effect

Search requests use the configured OneAPI service. Any tool-result tokens enter the normal model context when the agent uses the result.

#### KV Cache effect

Different search results may change subsequent prompt content and cache reuse; this package does not manage the model cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Model discovery, managed search and the expert catalog require a reachable OneAPI service. The desktop has no local provider-editing fallback.
- Independent expert launch requires the separate OneAPI `/api/expert-web` deployment and database tables; the ordinary login endpoint alone does not provide it.
- Website tickets and child Webview permissions still require live service and cross-platform desktop acceptance.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
