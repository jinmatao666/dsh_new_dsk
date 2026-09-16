# Agent Note: Wanwei product overlay

Status: implemented

English | [中文](2026-09-16-wanwei-product-overlay.zh.md)

## Problem

Wanwei desktop behavior needs a stable owner outside the official base and Web bundles. Editing those bundles directly makes every upstream update mix product policy with framework changes and prevents maintainers from identifying the minimum compatibility work.

## Decision

The shipped `wanwei-desktop` profile composes `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and `@deepseek-ai/dsh-wanwei-desktop` in that order. The final private bundle owns every Wanwei-specific row and override, while feature packages own their runtime behavior and mutable invariants.

The product bundle began with an empty patch. Each private capability enters as a separate package and one explicit patch entry, so its dependency, tests, and removal remain independent from the official composition. The first capability is `@deepseek-ai/dsh-wanwei-oneapi-auth`: its Host face owns login, credentials, model synchronization, and provider policy, while its Client face owns the blocking login gate and account page through the official Slot and Locale services. The Client face also owns the complete Wanwei product introduction and sign-in presentation. Its purple preview palette distinguishes this product generation without modifying the official Web theme; account login remains live, while unconfigured SMS, QR, password-recovery, legal, and account-request actions remain visibly unavailable.

Only profile discovery, the CLI installation closure, and the Host build aggregate reference the product bundle from existing packages. Product behavior does not enter those integration points.

The manual-only `wanwei-desktop-preview.yml` workflow owns Windows installer production. It builds `products/wanwei-desktop` on a Windows runner, stages the self-contained runtime through the product script, uploads a preview-specific artifact, and can publish a prerelease under a product-specific tag. It has no push trigger and no container, OneAPI deployment, or database job.

## Alternatives considered

**Continue patching official packages.** This keeps each immediate edit close to its current consumer but recreates the upgrade-wide conflict set that the product layer is intended to remove.

**Copy the complete official Web patch into a Wanwei bundle.** This creates an immediately self-contained tree but duplicates upstream composition and requires manual synchronization whenever official rows change.

**Keep the product profile only in installer scripts.** This avoids repository integration points but leaves source launches, configuration dumps, tests, and packaged launches with different composition owners.

## Consequences

Wanwei features gain one ordered composition boundary and can be ported independently. The repository carries a small permanent integration diff for the profile template, CLI dependency, build reference, documentation, real built-profile test, and manual installer workflow. Product authentication and its branded entry screen are now isolated in one removable package; they reuse the existing OneAPI protocol and persistence instead of changing the service image, database, or official Web theme. Installer publication can therefore advance independently from the existing OneAPI service and its data.
