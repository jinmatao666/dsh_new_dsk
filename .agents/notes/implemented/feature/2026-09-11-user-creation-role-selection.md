# Agent Note: User creation role selection

Status: implemented

English | [中文](2026-09-11-user-creation-role-selection.zh.md)

## Problem

Administrators need to create user accounts with an explicit business role instead of relying on an implicit default.

## Decision

The administrative user-creation form presents two roles: common user and root user.

Only a root user can select and create another root user.

The server accepts only those two roles for this creation path, treats an omitted role as a common user for existing callers, and rejects a root-user request from every other role.

Existing administrator accounts and their module permissions remain unchanged.

## Alternatives considered

Expose the existing administrator role in the creation form.

Administrator access is already managed through the dedicated administrator-permissions page, while the requested account-creation flow has two business choices.

Trust the browser to hide the root-user option.

A crafted request could bypass the browser, so the server must enforce the same restriction.

## Consequences

New accounts receive an explicit common-user or root-user role.

The creation dialog stays simple, and non-root administrators cannot create privileged accounts.
