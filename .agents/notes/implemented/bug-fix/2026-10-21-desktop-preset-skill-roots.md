# Agent Note: Desktop skill roots across preset scopes

Status: implemented

English | [中文](2026-10-21-desktop-preset-skill-roots.zh.md)

## Problem

The Web bundle disables the host filesystem skill provider. Agent presets mount separate providers whose defaults scan the shared user agents directory and parent Git root. Configuring only the disabled host row leaves those active providers unrestricted. The draft catalog also invents a workspace by using the user's home cwd.

## Decision

The desktop mounts a host-owned filesystem discovery policy and enables its host provider for installed skills. All descendant filesystem providers consult that service for project-root selection and shared-user discovery. Policy publication and disposal invalidate provider catalogs. Generic profiles without the policy keep their defaults; explicit custom and bundled roots remain supported.

The pre-Session catalog omits cwd. Session catalogs retain their actual workspace and preset scope. No skill files are deleted, and the policy is directory discovery, not process confinement.

## Alternatives considered

**Patch only shipped preset YAML.** Locally authored copies retain their own defaults and can reproduce the same leak. One host policy also covers future presets without editing user files.

**Delete external skills or hide them in the client.** Deletion damages other applications; client filtering leaves the model's loader able to see the same external skills. Discovery applies the restriction before either consumer reads the catalog.

## Consequences

The desktop has one additional host service and exported plugin entry. Regression tests load the desktop policy through Loader, mount the filesystem rows from shipped Standard, PTC and Cordis presets through standing preset scopes, and verify both allowed and excluded skill names. Generic defaults, policy cache invalidation and nondestructive disposal have separate coverage. Rebuilding and restarting the desktop Host is required to update an installed application.
