# Agent Note: Allow authenticated login with no managed models

Status: implemented

English | [中文](2026-11-05-login-with-empty-model-catalog.zh.md)

## Problem

An empty permitted model catalog prevented a valid account from entering the desktop and forced model onboarding before local configuration.

## Decision

Successful authentication remains valid when either the current model-detail endpoint or the legacy models endpoint returns an empty catalog. Only the managed route is synchronized; no default selection is chosen from an empty catalog. Invalid credentials still log out. The Buddy model-settings policy skips first-run model onboarding, including late policy registration.

## Alternatives considered

Treating an empty model catalog as invalid credentials conflates account identity and model access.

## Consequences

Users can enter settings and configure local models before chatting. Model requests still require a usable model; network and authentication failures retain their previous behavior.
