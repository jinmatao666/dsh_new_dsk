---
description: "Private desktop product plugins: authentication, catalogs, document tools, vision, and presentation."
kind: "package-group"
---

# wanwei/ — private product plugins

English | [中文](README.zh.md)

## Summary

These plugins provide the desktop product's sign-in, managed catalogs, local document tools, image recognition, and presentation. The desktop bundle assembles them over public DSH extension interfaces. They remain private distributions and do not participate in official npm releases.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package owns its configuration and behavior.

| Package | Contribution |
|---|---|
| [oneapi-auth](oneapi-auth/README.md) | Sign-in, managed models, and administration-service access |
| [product-ui](product-ui/README.md) | Branding, file import, and artifact presentation |
| [skill-marketplace](skill-marketplace/README.md) | Skill catalogs and independent expert websites |
| [skillhub](skillhub/README.md) | External skill discovery and installation |
| [document-local](document-local/README.md) | Local document tools |
| [vision](vision/README.md) | Server-governed image recognition |

<a id="related-documentation"></a>
## Related documentation

- [Web Client](../../docs/subsystems/web-client.md) — shared browser services and plugin assembly.
- [Desktop bundle](../bundle/wanwei-desktop/README.md) — product composition.
- [Decoupling rules](../../WANWEI_DECOUPLING_RULES.md) — dependency and ownership requirements.

<a id="dev-note"></a>
## Dev Note

None.
