# Agent Note: Independent land-market desktop login tickets

Status: implemented

English | [中文](2026-11-09-portal-land-market-desktop-login.zh.md)

## Problem

The land-market desktop entry only iframe-loaded an admin URL, so ais-land could not receive the signed-in desktop user. Expert-web tickets were the wrong registration surface for this portal.

## Decision

Add OneAPI `/api/portal/land-market/{launch,redeem}` plus admin credential rotate/status. Store the provider secret digest in Option `LandMarketProviderSecretHash` (not in public `desktop-config`). Workbench Feature Settings → land-market address dialog gains Generate/Reset credential. Desktop portals call Host `land-market-launch` before iframe load and embed the ticket; ais-land redeems via ais-manager-server.

## Alternatives considered

**Reuse expert-web profiles:** Rejected so land market stays under Feature Settings and does not appear in the expert catalog.

**Put the secret hash inside `featurePages` JSON:** Rejected because `/api/desktop-config` publishes that object to clients before login.

## Consequences

OneAPI needs the new table/option and admin UI. Desktop portals depend on `connection` for launch RPC. Deployments must set ais-manager `desktop.land-market.redeem-url` to `…/api/portal/land-market/redeem` and the rotated credential.
