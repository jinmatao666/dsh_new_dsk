# Agent Note: Runtime backend deployment paths

Status: implemented

English | [中文](2026-10-30-runtime-backend-deployment.zh.md)

## Problem

Build-time public URLs tie otherwise identical backend releases to individual networks. Prefix changes also affect lazy scripts, icons, authentication redirects and desktop artifact URLs.

## Decision

The backend validates public configuration before opening databases. It injects public settings and a base element into uncached HTML; immutable bundles select Webpack asset roots, router basenames and API bases from those settings. Server routing strips configured prefixes before Gin routing. Canonical API URLs retain their complete path, while management callbacks use the separately resolved management URL. External third-party URLs remain unchanged.

The standalone delivery entry keeps site configuration and persistent data outside the image, checks a local versioned image without network access, and changes only image identity during upgrades. Organization management retains its separate port. Specialized server and expert checks remain outside generic delivery. The [operational reference](../../../../services/one-api/deploy/README.md) owns deployment details.

## Alternatives considered

**Customer-specific frontend builds.** They multiply artifacts and make an Internet-validated image unsuitable for direct offline transfer.

**Nginx rewriting bundled scripts.** Hashed and compressed artifacts and lazy loading make deployment correctness depend on implementation details of every build.

**Forwarded headers as canonical URL configuration.** Multiple proxies can overwrite protocol, host or prefix information. Explicit complete URLs avoid those ambiguities; forwarded client-IP trust has an independent allowlist.

## Consequences

Sites recreate containers to change paths and configure gateways to preserve prefixes. Canonical URL paths must agree with the runtime prefixes. Configuration initialization never overwrites site values; program rollback preserves databases and cannot undo migrations. Architecture remains an image-release dimension rather than a customer branch.

## Testing

Focused Go and React tests cover validation, routing, navigation and URL generation. Embedded production assets and a local browser smoke cover root and two prefix pairs using the same frontend build with mock APIs. Delivery tests isolate Docker calls and verify configuration preservation and architecture rejection. Docker image construction, real desktop/model traffic, production proxy behavior and database recovery acceptance are deferred at the user's request; local checks do not claim those outcomes.
