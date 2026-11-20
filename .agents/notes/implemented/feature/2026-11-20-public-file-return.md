# Agent Note: Public files return to the recorded uploader

Status: implemented

English | [中文](2026-11-20-public-file-return.zh.md)

## Problem

Workbench operators need uploader attribution and a way to return individual public files to their uploader's private library. The public library creator and the administrator operating the workbench can differ from the file uploader.

## Decision

The file list uses the existing document-creator records and displays uploader names even for the current administrator. Return destinations are unpublished, uncategorized personal libraries owned by that recorded uploader. The destination request has a 15-second timeout, and request failures end the loading state with an error in the dialog. The backend rechecks ownership on submission. Transfers reuse the existing move operation with capacity enforcement and keep-both naming. Target uploader persistence must succeed before source removal.

## Alternatives considered

**Using the library creator or current operator for unknown uploaders.** Those identities can belong to different people. Missing records hide the operation, and an empty destination list requires creation of a personal library before retrying.

## Consequences

Returning removes the public file after successful target upload, while retaining the uploader identity. A remote source-delete failure reports the retained target copy through the existing transfer error. The operation does not withdraw the entire library or change its owner.
