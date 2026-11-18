# Agent Note: Publication withdrawal and subscription credit limits

Status: implemented

English | [中文](2026-11-16-knowledge-publication-controls.zh.md)

## Problem

Personal-library owners need to stop sharing a published library without losing its files. Administrators also need to bound per-file prices and inspect the material attached to a review.

## Decision

Only the owner may withdraw an approved publication. OneAPI clears its public or subscription scope and associated applications and grants in one transaction. A later publication requires a new review. Usage receipts and the original library remain available. The operations sidebar labels personal entries with the owner’s name and shared entries with 万维.

The administrator saves the platform percentage and three maxima in one policy. Amounts use hundredths of a credit. Each maximum defaults to 10 credits until the administrator saves a policy. The server rejects newly entered amounts above the applicable limit and caps existing prices when quoting and settling new uses. Zero caps make the matching action free. Settled receipts preserve the original amounts.

The review dialog reads files through the application’s administrator routes. The file tab loads a page at a time, and preview reuses the workbench viewer.

## Alternatives considered

Hiding the shared card alone would leave direct access and old grants available. Validating prices only in the desktop form would allow stale clients to submit or charge higher amounts.

## Consequences

Owners keep their documents and can publish again after withdrawal. Subscribers must reapply if a withdrawn library is published again. Administrators can review source files without changing their library permissions.
