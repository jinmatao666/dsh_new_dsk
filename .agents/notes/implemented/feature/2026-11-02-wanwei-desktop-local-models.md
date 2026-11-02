# Agent Note: Wanwei desktop users can configure local model providers

Status: implemented

English | [中文](2026-11-02-wanwei-desktop-local-models.zh.md)

## Problem

Wanwei desktop exposed only the models granted by its OneAPI server. The generic model editor was disabled, and authentication replaced the entire provider settings section on login and logout. A desktop user could not keep a separate model service.

## Decision

The Wanwei bundle enables the generic Models settings editor without its generic onboarding. OneAPI owns the `dsh-server` route: the editor shows that route and its authorized model catalog without local edit or delete controls. Other provider profiles and credentials remain desktop-owned. The composer model menu opens the Models settings section and continues to group models by provider.

Authentication mutates only `providers.dsh-server`. Login preserves a selected local default model; logout removes only the managed route. This keeps backend policy and user configuration under separate owners in the same settings namespace.

## Alternatives considered

**Build a second Wanwei-specific provider editor:** rejected because the generic editor already handles OpenAI-compatible endpoints, credentials, model catalogs, and provider removal.

**Keep replacing the whole provider section:** rejected because every login or logout would erase user-created providers.

## Consequences

Users still need a Wanwei account to enter the desktop app. Their local model API keys are stored through the existing desktop credential service. A managed model chosen before login may move to the server default when the authorized catalog refreshes; a local provider selection remains selected.
