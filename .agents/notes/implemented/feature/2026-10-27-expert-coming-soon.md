# Agent Note: Shared static placeholder for unavailable experts

Status: implemented

English | [中文](2026-10-27-expert-coming-soon.zh.md)

## Problem

Expert cards can precede their actual services. An invented workbench URL gives users a connection error rather than an honest availability message.

## Decision

[The coming-soon directory](../../../../expert-web/coming-soon/README.md) owns one self-contained static notice that multiple cards can share after deployment. It drops the launch fragment without redeeming tickets, invoking the desktop bridge, accepting input or reporting usage. Its optional Nginx fragment authorizes only exact inline script and style hashes. Existing expert keys, credentials, services and routes are unchanged.

## Alternatives considered

A separate stub service per expert duplicates deployment work. Returning a fake task result misrepresents capability. Redirecting to the platform homepage obscures the selected expert's unavailable state.

## Consequences

The notice needs no model, identity provider or task storage. It does not identify the selected expert or promise a launch date. Shared-origin production hosting still requires review. Gateway file visibility and routing remain deployment prerequisites; this change does not configure a server or edit existing cards.

## Verification

Focused static tests check the unavailable message, absence of operational APIs, fragment removal, mobile styling and exact CSP hashes. Local browser checks cover desktop/mobile layout and fragment clearance. Target-server mounts, Nginx validation and Buddy entry remain deployment acceptance work.
