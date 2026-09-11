# Agent Note: Admin development skill mock data

Status: implemented

English | [中文](2026-09-11-admin-development-skill-mock-data.zh.md)

## Problem

The local One API administration frontend needs populated skill-library and category-management views without a running service or persisted demonstration records.

## Decision

The two views load their existing static mock records only when the frontend runs in development mode with `REACT_APP_USE_SKILL_MOCK_DATA=true`.

All other builds retain the existing API-backed loading path.

Mock mode rejects actions that would save, delete, or change a published state, so previewing the data cannot modify a One API service.

## Alternatives considered

Seed a local One API database.

This would require a separate service and create state outside the frontend, although the preview only needs table data.

Enable the mock records by default.

This could cause a release build to present demonstration entries instead of server data.

## Consequences

Developers can inspect populated administration views by setting one explicit local environment variable.

Production images continue to read their skill and category records from One API.
