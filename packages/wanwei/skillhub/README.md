---
description: "Browse public SkillHub skills and download pinned archives through the Wanwei desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skillhub

English | [中文](README.zh.md)

## Summary

Users browse and search public SkillHub skills inside the Wanwei market. Downloads select an explicit remote version. The desktop owns local installation and source receipts. Platform recommendations continue to contain only platform skills.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The [Wanwei bundle](../../bundle/wanwei-desktop/cordis.patch.yml) mounts this plugin on the authenticated local Host connection. SkillHub access does not require the OneAPI authentication plugin. Native installation is available only in the product desktop.

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | required | HTTPS SkillHub origin. |
| `timeoutMs` | required | Upstream request deadline in milliseconds. |
| `maxJsonBytes` | required | Maximum streamed JSON response size. |
| `maxArchiveBytes` | required | Maximum downloaded ZIP size; desktop installation also caps archives at 16 MiB. |
| `downloadHosts` | required | Exact HTTPS object-storage hostnames allowed for download redirects. |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host validates upstream responses and maps them into product data, including the public download count and icon URL. Raster icons are proxied only from Tencent's `cloudcache.tencent-cloud.com` host, without redirects and with a 256 KiB limit; unsupported icons fall back to a local glyph. Downloads follow a bounded redirect chain and return base64 bytes with a transport SHA-256 digest through authenticated RPC. This digest detects transfer changes; it is not a publisher signature. The desktop stages installation before publishing a directory and records remote slug, remote version, actual local skill name and source. Manual updates replace only a matching SkillHub receipt and retain the previous directory until the new version is published. Uninstall requires a matching local receipt. Platform installation and removal reject SkillHub-owned directories.

Local receipts remain usable offline. Selecting Use stages the actual installed skill name in the existing conversation draft. The marketplace owns presentation; this plugin never imports Client UI or modifies the agent loop.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Marketplace](../skill-marketplace/README.md) — presentation and skill invocation.
- [Product boundaries](../../../WANWEI_DECOUPLING_RULES.md) — ownership constraints.
- [SkillHub API](https://github.com/Tencent/skillhub/blob/main/docs/api/README.md) — upstream requirements.

<a id="model-experience"></a>
## Model Experience

### Public skill discovery

#### What the model sees

Browsing, downloading and installing do not send a model request. An installed skill becomes discoverable through the existing filesystem provider. The model receives `SKILL.md` instructions only through the ordinary skill-loading flow.

#### Token effect

Catalog operations consume no model tokens. Sending the staged skill command and loading instructions use normal DSH token accounting.

#### KV Cache effect

Catalog operations do not alter model context. Loading a skill may change the subsequent request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Public API availability, commercial terms and future team-key requirements belong to SkillHub; no embedded shared credential is shipped.
- Paid downloads, private skills and automatic version updates are not supported; users can manually update when SkillHub reports a newer version. Extra runtimes, tools and credentials required by a skill remain user-managed.
- Native imports retain the existing 128-entry, 16 MiB expanded-size and 16-level directory limits. Name conflicts are rejected rather than renamed or overwritten.
- A change in the upstream storage or icon hostname requires an adapter update. Remote descriptions are displayed through the existing controlled Markdown renderer.

<a id="dev-note"></a>
### Dev Note

None.
