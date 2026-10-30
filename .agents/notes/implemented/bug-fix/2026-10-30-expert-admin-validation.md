# Agent Note: Specific expert editor errors and consistent search styling

Status: implemented

English | [中文](2026-10-30-expert-admin-validation.zh.md)

## Problem

The expert search field used a gray default unlike skill management. Create and update collapsed validation failures into an ambiguous message, including missing providers and oversized images.

## Decision

Reuse the skill search field's white background, dimensions, border and focus treatment through scoped expert selectors. Validate common editable fields before sending and return the backend validation message for both create and update. Separate name, provider, summary, footer, icon, tag and section errors. Check duplicate keys separately from persistence failures without exposing SQL details.

## Alternatives considered

Keeping a generic message requires users to guess. Frontend checks alone do not cover direct API calls or old clients.

## Consequences

Existing validation limits remain unchanged. Empty popup section bodies remain valid. The first invalid field is reported; a concurrent duplicate insert can still receive the generic persistence failure. No schema migration is needed.

## Testing

Controller tests exercise create and update responses for invalid fields, duplicate keys and database-check failures. Windows lacks a C compiler; database tests pass with a temporary Go overlay selecting the existing pure-Go SQLite driver, without modifying production or committed test-driver imports. Frontend tests cover draft validation and existing editor behavior. Search selectors copy the established skill search rules; actual deployment requires a rebuilt backend image.
