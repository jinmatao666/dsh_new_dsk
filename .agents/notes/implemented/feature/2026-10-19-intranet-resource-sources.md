# Agent Note: Exclusive intranet resource sources

Status: implemented

English | [中文](2026-10-19-intranet-resource-sources.zh.md)

## Problem

Disconnected desktops need script dependencies without assuming that an intranet label establishes actual Internet connectivity. Administrators also need control over download latency and must not silently cross between offline bundles and an Internet relay.

## Decision

OneAPI's public deployment configuration carries an optional resource selection: `offline` or `proxy`. Root administrators upload wheel-only ZIPs independently of saving the selected source. Content-addressed wheel URLs retain SHA-256 fragments and survive bundle replacement. Resource artifacts contain dependencies, not private documents.

The Wanwei Host applies the selection to its dedicated sidecar environment before new shell work. Offline pip uses no index and only the backend wheel library; proxy-aware external downloads receive a failing loopback proxy in that mode. Proxy mode clears offline pip variables and uses an HTTP forward proxy. Both preserve internal platform access. Neither mode falls back to the other.

Automatic detection applies only to proxy mode. Direct HTTPS requests use a dedicated non-proxy agent, require HTTP 204 from every configured endpoint, time out in 2.5 seconds concurrently and cache decisions for 60 seconds. Configuration revisions discard obsolete probe results. Shell configuration refresh failures deny new commands instead of assuming Internet access. Existing processes retain their original environment.

The model receives source-specific dependency guidance through the existing network prompt section. Generic web search and public-link restrictions remain independent. Source settings are shared pure data; Node networking stays in the Host-only module.

## Alternatives considered

Automatic cross-source fallback defeats administrator control over latency. System-wide proxy settings affect unrelated applications and require machine-level authority. Rewriting shell command text is not a reliable process policy and violates immutable tool arguments. A custom forward-proxy implementation adds protocol and security obligations; the deployment scaffold uses Squid with a client subnet allowlist and restricted destinations instead.

## Consequences

The first release supports Python wheels and proxy-aware child download clients. It is not a firewall: explicit client overrides, native PowerShell, Node fetch, browser traffic and existing terminal sessions are not comprehensively routed. Offline npm, source builds, system packages and proxy credentials remain outside this implementation. Administrators must persist the resource directory, maintain bundle retention and restrict relay access at the server firewall.

Focused tests cover public validation, archive rejection, atomic bundle replacement, a real pip installation from the backend, Python HTTP through a test relay, environment restoration, cached detection, stale probes and a Loader-composed prompt snapshot. This Windows machine has no Docker; actual Squid startup and installed-desktop acceptance remain release-operator checks described in the [resource guide](../../../../products/wanwei-desktop/resource-relay/README.md).
