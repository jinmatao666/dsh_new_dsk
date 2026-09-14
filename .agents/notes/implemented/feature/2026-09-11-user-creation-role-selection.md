# Agent Note: User creation role selection

Status: implemented

English | [中文](2026-09-11-user-creation-role-selection.zh.md)

## Problem

Administrators need to create user accounts with an explicit business role instead of relying on an implicit default.

## Decision

The administrative user-creation and edit forms load active roles from the role-management API.

Each selected role number is stored directly in `users.role`.

The server accepts a selected role only when a matching active role record exists. An omitted role continues to select the common-user role.

Numbers from 10 upward remain reserved for the existing system-management checks; custom roles use numbers from 2 through 9.

## Alternatives considered

Keep a fixed pair of common-user and root-user options.

The user form would not reflect roles created through role management.

Trust the browser to hide the root-user option.

A crafted request could bypass the browser, so the server must enforce the same restriction.

## Consequences

New and edited accounts receive an explicit role that exists in the role-management table.

The existing numeric system-management checks remain intact while role permissions can define model access for each role.
