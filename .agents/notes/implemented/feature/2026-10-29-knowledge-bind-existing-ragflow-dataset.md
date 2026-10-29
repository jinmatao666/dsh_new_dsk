# Agent Note: Bind existing RAGFlow datasets from the workbench

Status: implemented

English | [中文](2026-10-29-knowledge-bind-existing-ragflow-dataset.zh.md)

## Problem

Users often already have datasets on the RAGFlow knowledge platform (`{RAGFLOW_BASE_URL}/datasets`). The create dialog only called RAGFlow to create a blank dataset, so those existing libraries could not be filed into OneAPI without re-uploading content.

## Decision

Create offers two sources for every signed-in user: create a blank RAGFlow dataset (unchanged), or bind a dataset already returned by `GET {RAGFLOW_BASE_URL}/api/v1/datasets` using the configured `RAGFLOW_API_KEY`. `GET /api/knowledge-bases/ragflow-datasets` and `GET /api/knowledge-admin/ragflow-datasets` (both UserAuth) walk that list and omit ids already stored on `knowledge_bases.ragflow_dataset_id`. `POST /api/knowledge-bases` and `POST /api/knowledge-admin/bases` accept optional `ragflow_dataset_id`: OneAPI verifies the dataset exists, rejects a second bind with 409, writes the local library row, and does not call create or compensate-delete on RAGFlow for that path. After bind, document and delete behavior treat the dataset like any other managed library.

## Alternatives considered

**Open the RAGFlow UI URL in a new tab and paste the dataset id:** rejected because OneAPI already holds the API key server-side and can list datasets without exposing credentials to the browser.

**Auto-import every unbound dataset as a workbench library:** rejected because filing into a category, naming, cover, and shelf remain explicit user choices.

**Restrict bind to administrators only:** rejected; any signed-in user who can create a library may also bind an unbound RAGFlow dataset into their own (or category) library.

## Consequences

OneAPI must keep `RAGFLOW_BASE_URL` and `RAGFLOW_API_KEY` pointed at the same RAGFlow origin users manage in the browser. Binding does not copy documents; the local library points at the existing dataset id. Deleting the library still deletes that RAGFlow dataset. A dataset already linked to a local row never appears in the picker. The picker lists every unbound dataset visible to the shared API key, so deployments that share one RAGFlow tenant across many OneAPI users must accept that inventory is visible to all creators.

## Testing

RAGFlow client tests cover list paging with envelope `total_datasets`, get-by-id, and walking pages. OneAPI controller tests cover the unbound list filter, successful bind for admin and ordinary users without creating a remote dataset, and duplicate-bind conflict. The workbench page test selects 选择已有知识库 for both admin and ordinary users and posts `ragflow_dataset_id`.
