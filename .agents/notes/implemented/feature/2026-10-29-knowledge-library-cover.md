# Agent Note: Knowledge library cover images

Status: implemented

English | [中文](2026-10-29-knowledge-library-cover.zh.md)

## Problem

Plaza cards share one staged landscape, so libraries in 知识库广场 are hard to tell apart. People creating or editing a library on the workbench need to attach a picture the plaza can show, and the workbench edit dialog needs to replace or clear that picture.

## Decision

`knowledge_bases.cover` stores an optional compact JPEG data URL. `POST /api/knowledge-bases` (desktop create, and workbench create through the admin flag on the same handler) accepts `cover`. `PUT /api/knowledge-admin/bases/:id` updates `cover` only when the field is present: a picture replaces the stored value, and an empty string clears it. Omitting `cover` leaves the stored value, including a rename or a shelf-only update. OneAPI accepts an empty cover or a PNG, JPEG, WebP, or GIF data URL and stores a JPEG data URL of at most 60 KiB. Anything else fails with 封面图片无效 before RAGFlow is called. The workbench creation and edit dialogs read a local image of at most 8 MB and send that data URL. The desktop create dialog does not show cover upload. Plaza cards and the plaza detail render `cover` when it is a `data:image/` URL, and otherwise render `/knowledge-covers/plaza-natural-resources.jpg`. The open library header on the desktop and the workbench card mark use the same image when it is present. See [knowledge library subscription plaza](2026-10-23-knowledge-library-subscription.md) for which libraries appear on the plaza.

## Alternatives considered

**Store the original file on disk and serve a URL:** rejected because skill and expert images already live on the row as data URLs, and a separate asset route would need cleanup when the library is deleted.

**Require a cover on every library:** rejected because existing rows and a create that only has a name must still appear, using the staged photo.

**Add a desktop control that replaces the cover after creation:** rejected because the desktop page has no library metadata editor. The workbench edit dialog already saves name, description, and tags, and only an administrator can open it.

**Show cover upload on the desktop create dialog:** deferred. Cover setting stays on the workbench create and edit dialogs for now; the desktop still displays a stored cover on the plaza and the open library header.

## Consequences

Desktop, workbench, and OneAPI ship together. AutoMigrate adds `knowledge_bases.cover` as text. Plaza and catalog responses grow by that data URL for each library that has a cover. A stored cover is a JPEG data URL even when the upload was PNG, WebP, or GIF. Clearing the cover restores the staged photo on the plaza. A person who is not a workbench administrator cannot set or change a cover from the desktop create dialog.

## Testing

`NormalizeKnowledgeCover`, create rejection and storage, and workbench update replace, omit, and clear are covered by the OneAPI model and controller tests. The desktop page test asserts create has no cover upload and renders a plaza cover. The workbench page test submits a cover on create and on edit.
