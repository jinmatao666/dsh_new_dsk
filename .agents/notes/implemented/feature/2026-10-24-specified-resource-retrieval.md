# Agent Note: Specified website resources through the intranet relay

Status: implemented

English | [中文](2026-10-24-specified-resource-retrieval.zh.md)

## Problem

Proxy-aware dependency clients do not give the model a reliable path from a user-specified website to a locally delivered file. Native web fetch remains separately restricted in intranet deployments, and replacing its transport globally risks changing authentication, model and expert-service traffic.

## Decision

The private Wanwei resource router materializes a standard-library Python module for new intranet relay Shell commands. The module reads bounded page text and discovered links or downloads to an explicit workspace path, with certificate verification, redirect and byte limits, hashes, exclusive atomic publication and failed-transfer cleanup. It inherits the existing forward proxy or authenticated tunnel and automatic detection. Offline mode removes the module search path without switching sources. Model guidance names the real command and treats fetched content as untrusted; blocked public web_fetch calls point to that command. No new backend transfer API or general browser proxy is introduced. The normal Shell sandbox, execution record and final-file delivery remain the authority.

## Alternatives considered

A global Node dispatcher can unexpectedly route platform credentials and does not cover browsers. A new binary filesystem API or download tool would widen official capability contracts for a private product request. The Shell client keeps the existing sandbox and proxy ownership at the cost of requiring the bundled Python interpreter and not executing JavaScript sites or transferring browser login state.

## Consequences

The backend UI describes website and file retrieval; desktop builds must include the module. Native search, arbitrary browser traffic, CAPTCHA and authenticated site workflows are not claimed. Local real-Python smoke verification covers a test relay without target DNS, page links, redirects, binary bytes, path and overwrite rejection, HTML masquerading, size limits and cleanup. Vitest behavior and Loader snapshot checks pass. Production tunnel and installed-desktop acceptance remain release checks in the [resource guide](../../../../products/wanwei-desktop/resource-relay/README.md).
